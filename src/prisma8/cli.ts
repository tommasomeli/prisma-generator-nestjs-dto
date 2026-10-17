import fs from 'node:fs';
import path from 'node:path';
import { loadConfigFileFromPath, type LoadedConfigFile } from '../config-loader';
import { generate } from '../generator';
import { Utility } from '../utility';
import { locateContract, readContract } from './contract-reader';
import { contractToDatamodel } from './contract-to-dmmf';
import { buildPrisma8Options } from './options-shim';
import { loadPslAnnotations } from './psl-annotations';

/** Injected by tsup (`define`) at build time; undefined when running the TypeScript sources. */
declare const __PACKAGE_VERSION__: string | undefined;

const PACKAGE_NAME = '@tommasomeli/prisma-generator-nestjs-dto';
const BIN_NAME = 'prisma-generator-nestjs-dto';

/** Config file names probed in `cwd` when `--config` is omitted, in priority order. */
export const DEFAULT_CONFIG_FILES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json'].map((ext) => `nestjs-dto.config.${ext}`);

/** Prisma config file names probed in `cwd` when `--contract` is omitted, in priority order. */
export const DEFAULT_PRISMA_CONFIG_FILES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `prisma.config.${ext}`);

export const HELP_TEXT = `Usage: ${BIN_NAME} [options]

Generates NestJS DTOs (or Zod schemas) from a Prisma ORM 8 contract.
Run \`prisma contract emit\` first; Prisma 5-7 users keep using \`prisma generate\`.

Options:
  --contract <path>       contract.json, a .prisma file, a glob of .prisma files
                          (quote it) or a prisma.config.ts.
                          Default: ./prisma.config.ts when present.
  --prisma-config <file>  Alias of --contract for a prisma.config.ts.
  --output <dir>          Output directory.
                          Default: <contract dir>/../generated/nestjs-dto
  --config <file>         Generator config file (same format as \`configFile\`).
                          Default: ./nestjs-dto.config.{ts,mts,cts,js,mjs,cjs,json}
  -h, --help              Show this help.
  -v, --version           Show the version.

Set DEBUG=1 to print stack traces on failure.`;

/** Parsed command line. */
export type CliArgs = {
    contract?: string;
    prismaConfig?: string;
    output?: string;
    config?: string;
    help: boolean;
    version: boolean;
};

/** Thrown for invalid command lines; mapped to exit code 2. */
export class CliUsageError extends Error {}

/** Flags that take a value, mapped to their {@link CliArgs} key. */
const VALUE_FLAGS: Record<string, 'contract' | 'prismaConfig' | 'output' | 'config'> = {
    '--contract': 'contract',
    '--prisma-config': 'prismaConfig',
    '--output': 'output',
    '--config': 'config'
};

/** Parses `argv` (without `node` and the script). Accepts `--flag value` and `--flag=value`. */
export function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = { help: false, version: false };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '-h' || token === '--help') {
            args.help = true;
            continue;
        }
        if (token === '-v' || token === '--version') {
            args.version = true;
            continue;
        }
        const eq = token.indexOf('=');
        const flag = token.startsWith('--') && eq !== -1 ? token.slice(0, eq) : token;
        const key = VALUE_FLAGS[flag];
        if (!key) throw new CliUsageError(token.startsWith('-') ? `Unknown option: ${token}` : `Unexpected argument: ${token}`);
        let value: string | undefined;
        if (eq !== -1 && flag !== token) value = token.slice(eq + 1);
        else {
            value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) throw new CliUsageError(`Option ${flag} requires a value`);
            i++;
        }
        if (!value) throw new CliUsageError(`Option ${flag} requires a value`);
        if (args[key] !== undefined) throw new CliUsageError(`Option ${flag} given more than once`);
        args[key] = value;
    }
    if (args.contract && args.prismaConfig) throw new CliUsageError('Use either --contract or --prisma-config, not both');
    return args;
}

/** Reads the package version: build-time constant in `dist`, nearest matching `package.json` otherwise. */
export function getVersion(): string {
    if (typeof __PACKAGE_VERSION__ === 'string') return __PACKAGE_VERSION__;
    let dir = typeof __dirname === 'string' ? __dirname : process.cwd();
    for (;;) {
        const candidate = path.join(dir, 'package.json');
        try {
            const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (pkg?.name === PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
        } catch {
            // keep walking up
        }
        const parent = path.dirname(dir);
        if (parent === dir) return 'unknown';
        dir = parent;
    }
}

/** Dependencies of {@link runCli}; every one can be replaced in tests. */
export type CliDeps = {
    cwd: string;
    loadConfigFileFromPath: typeof loadConfigFileFromPath;
    locateContract: typeof locateContract;
    readContract: typeof readContract;
    loadPslAnnotations: typeof loadPslAnnotations;
    contractToDatamodel: typeof contractToDatamodel;
    buildPrisma8Options: typeof buildPrisma8Options;
    generate: typeof generate;
    /** Plain stdout writer (help, version). */
    print: (text: string) => void;
    /** Plain stderr writer (usage errors). */
    printError: (text: string) => void;
};

export const defaultCliDeps: CliDeps = {
    cwd: process.cwd(),
    loadConfigFileFromPath,
    locateContract,
    readContract,
    loadPslAnnotations,
    contractToDatamodel,
    buildPrisma8Options,
    generate,
    print: (text) => console.log(text),
    printError: (text) => console.error(text)
};

/** First existing file among `names` in `dir`, as an absolute path. */
function findFirst(dir: string, names: string[]): string | undefined {
    for (const name of names) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

/**
 * Prisma 8 CLI entry: `prisma-generator-nestjs-dto --contract <path|glob|prisma.config.ts> [--output <dir>] [--config <file>]`.
 * Flow: config file → locate + read `contract.json` → PSL annotations → synthetic DMMF → `GeneratorOptions` → `generate()`.
 *
 * @returns the process exit code: 0 on success, 1 on failure, 2 on usage errors.
 */
export async function runCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
    const d: CliDeps = { ...defaultCliDeps, cwd: process.cwd(), ...deps };
    let args: CliArgs;
    try {
        args = parseArgs(argv);
    } catch (error) {
        if (!(error instanceof CliUsageError)) throw error;
        d.printError(`${error.message}\n\n${HELP_TEXT}`);
        return 2;
    }
    if (args.help) {
        d.print(HELP_TEXT);
        return 0;
    }
    if (args.version) {
        d.print(getVersion());
        return 0;
    }

    const contractInput = args.contract ?? args.prismaConfig ?? findFirst(d.cwd, DEFAULT_PRISMA_CONFIG_FILES);
    if (!contractInput) {
        d.printError(`Missing --contract (no prisma.config.ts found in ${d.cwd})\n\n${HELP_TEXT}`);
        return 2;
    }

    try {
        const configPath = args.config ? path.resolve(d.cwd, args.config) : findFirst(d.cwd, DEFAULT_CONFIG_FILES);
        let configFile: LoadedConfigFile | null = null;
        if (configPath) {
            if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);
            configFile = await d.loadConfigFileFromPath(configPath, d.cwd);
            if (!configFile) throw new Error(`Failed to load config file ${configPath}`);
        } else Utility.log('No config file found; using defaults.');

        Utility.log(`Locating contract from ${contractInput}`);
        const location = await d.locateContract(contractInput, d.cwd);
        Utility.log(`Reading ${location.jsonPath}`);
        const contract = d.readContract(location);

        if (location.pslFiles.length > 0) Utility.log(`Reading annotations from ${location.pslFiles.length} PSL file(s)`);
        else Utility.warn('No PSL sources found next to the contract: `///` annotations will be ignored.');
        const annotations = await d.loadPslAnnotations(location.pslFiles);

        const userExtraScalars = configFile?.config.extraScalars ?? {};
        const datamodel = d.contractToDatamodel(contract, { annotations, scalarOverrideKeys: Object.keys(userExtraScalars) });
        Utility.log(`Converted contract: ${datamodel.models.length} model(s), ${datamodel.enums.length} enum(s), ${datamodel.types.length} type(s)`);

        const output = args.output ? path.resolve(d.cwd, args.output) : path.resolve(location.dir, '..', 'generated', 'nestjs-dto');
        const options = d.buildPrisma8Options({
            datamodel,
            output,
            configFile,
            schemaPath: location.pslFiles[0] ?? location.jsonPath
        });
        Utility.log(`Generating into ${output}`);
        await d.generate(options);
        Utility.log('Done.');
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Utility.error(message);
        if (process.env.DEBUG && error instanceof Error && error.stack) console.error(error.stack);
        return 1;
    }
}
