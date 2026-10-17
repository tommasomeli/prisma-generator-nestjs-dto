import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, runCli, type CliDeps } from '../src/prisma8/cli';
import type { GeneratorOptions } from '../src/types';
import type { SyntheticDatamodel } from '../src/prisma8/types';

const FIXTURE = path.resolve(__dirname, 'fixtures/prisma8/blog');
const EMPTY_DATAMODEL: SyntheticDatamodel = { models: [], enums: [], types: [], indexes: [] };

describe('prisma8 CLI: parseArgs', () => {
    it('parses value flags in both `--flag value` and `--flag=value` forms', () => {
        expect(parseArgs(['--contract', 'a.json', '--output=out', '--config', 'c.ts'])).toEqual({ contract: 'a.json', output: 'out', config: 'c.ts', help: false, version: false });
        expect(parseArgs(['--prisma-config=prisma.config.ts', '-h', '-v'])).toMatchObject({ prismaConfig: 'prisma.config.ts', help: true, version: true });
    });

    it('rejects unknown flags, positionals, missing values, duplicates and --contract + --prisma-config', () => {
        expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
        expect(() => parseArgs(['stray'])).toThrow(/Unexpected argument/);
        expect(() => parseArgs(['--output'])).toThrow(/requires a value/);
        expect(() => parseArgs(['--output', '--config', 'x'])).toThrow(/requires a value/);
        expect(() => parseArgs(['--output=a', '--output=b'])).toThrow(/more than once/);
        expect(() => parseArgs(['--contract', 'a', '--prisma-config', 'b'])).toThrow(/not both/);
    });
});

describe('prisma8 CLI: runCli', () => {
    let tmp: string;
    let prismaDir: string;
    let printed: string[];
    let printedErrors: string[];
    let generate: ReturnType<typeof vi.fn>;
    let contractToDatamodel: ReturnType<typeof vi.fn>;
    let loadPslAnnotations: ReturnType<typeof vi.fn>;

    const deps = (): Partial<CliDeps> => ({
        cwd: tmp,
        generate: generate as unknown as CliDeps['generate'],
        contractToDatamodel: contractToDatamodel as unknown as CliDeps['contractToDatamodel'],
        loadPslAnnotations: loadPslAnnotations as unknown as CliDeps['loadPslAnnotations'],
        print: (text) => printed.push(text),
        printError: (text) => printedErrors.push(text)
    });
    const options = (): GeneratorOptions => generate.mock.calls[0][0];
    const scalars = () => JSON.parse(options().generator.config.extraScalars as string);

    beforeEach(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-p8cli-')));
        prismaDir = path.join(tmp, 'src/prisma');
        fs.mkdirSync(prismaDir, { recursive: true });
        fs.copyFileSync(path.join(FIXTURE, 'contract.json'), path.join(prismaDir, 'contract.json'));
        fs.copyFileSync(path.join(FIXTURE, 'contract.prisma'), path.join(prismaDir, 'contract.prisma'));
        printed = [];
        printedErrors = [];
        generate = vi.fn(async () => undefined);
        contractToDatamodel = vi.fn(() => EMPTY_DATAMODEL);
        loadPslAnnotations = vi.fn(async () => new Map());
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('--help and --version print and exit 0 without generating', async () => {
        expect(await runCli(['--help'], deps())).toBe(0);
        expect(printed[0]).toContain('--contract');
        expect(await runCli(['--version'], deps())).toBe(0);
        expect(printed[1]).toBe(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version);
        expect(generate).not.toHaveBeenCalled();
    });

    it('exits 2 with the help text on usage errors and when no --contract or prisma.config.ts is available', async () => {
        expect(await runCli(['--bogus'], deps())).toBe(2);
        expect(printedErrors[0]).toContain('Unknown option: --bogus');
        expect(printedErrors[0]).toContain('Usage:');
        expect(await runCli(['--output', 'x'], deps())).toBe(2);
        expect(printedErrors[1]).toContain('Missing --contract');
        expect(generate).not.toHaveBeenCalled();
    });

    it('runs the full flow and hands generate() Prisma 8 options with the default output', async () => {
        expect(await runCli(['--contract', 'src/prisma/contract.prisma'], deps())).toBe(0);
        expect(loadPslAnnotations).toHaveBeenCalledWith([path.join(prismaDir, 'contract.prisma')]);
        expect(contractToDatamodel.mock.calls[0][0].domain).toBeDefined();
        expect(contractToDatamodel.mock.calls[0][1]).toMatchObject({ scalarOverrideKeys: [] });
        const opts = options();
        expect(opts.generator.config.prisma8).toBe('true');
        expect(opts.generator.config.configFile).toBeUndefined();
        expect(opts.generator.output?.value).toBe(path.join(tmp, 'src/generated/nestjs-dto'));
        expect(opts.schemaPath).toBe(path.join(prismaDir, 'contract.prisma'));
        expect(opts.dmmf.datamodel).toEqual(EMPTY_DATAMODEL);
    });

    it('injects the D3 extraScalars defaults (Decimal → string, Json → JsonValue)', async () => {
        expect(await runCli(['--contract', 'src/prisma/contract.json'], deps())).toBe(0);
        expect(scalars()).toEqual({ Decimal: { ts: 'string', format: 'decimal' }, Json: { ts: 'JsonValue', from: '@prisma/orm-framework/utils/json', apiType: '() => Object', typeOnly: true } });
    });

    it('a user-defined Decimal override in the config file wins; Json keeps its default; relative `from` resolves against the config dir', async () => {
        const configDir = path.join(tmp, 'config');
        fs.mkdirSync(configDir);
        fs.writeFileSync(
            path.join(configDir, 'dto.config.ts'),
            "export default { prettier: false, extraScalars: { Decimal: { ts: 'Big', from: './big' }, 'pg/vector@1': { ts: 'number[]' } } };\n"
        );
        expect(await runCli(['--contract', 'src/prisma/contract.json', '--config', 'config/dto.config.ts'], deps())).toBe(0);
        expect(contractToDatamodel.mock.calls[0][1].scalarOverrideKeys).toEqual(['Decimal', 'pg/vector@1']);
        expect(scalars()).toEqual({
            Decimal: { ts: 'Big', from: path.join(configDir, 'big') },
            Json: { ts: 'JsonValue', from: '@prisma/orm-framework/utils/json', apiType: '() => Object', typeOnly: true },
            'pg/vector@1': { ts: 'number[]' }
        });
        expect(options().generator.config.prettier).toBe('false');
    });

    it('injects only the Zod D3 default (Decimal → z.string()) in Zod mode', async () => {
        fs.writeFileSync(path.join(tmp, 'nestjs-dto.config.json'), JSON.stringify({ outputType: 'zod' }));
        expect(await runCli(['--contract', 'src/prisma/contract.json'], deps())).toBe(0);
        expect(options().generator.config.outputType).toBe('zod');
        expect(scalars()).toEqual({ Decimal: { ts: 'string', zod: 'z.string()' } });
    });

    it('--output wins over the default and resolves against cwd', async () => {
        expect(await runCli(['--contract', 'src/prisma/contract.json', '--output', 'out/dto'], deps())).toBe(0);
        expect(options().generator.output?.value).toBe(path.join(tmp, 'out/dto'));
    });

    it('defaults --contract to ./prisma.config.ts and accepts --prisma-config', async () => {
        fs.writeFileSync(path.join(tmp, 'prisma.config.ts'), "export default { orm: { contract: './src/prisma/contract.prisma' } };\n");
        expect(await runCli([], deps())).toBe(0);
        expect(options().schemaPath).toBe(path.join(prismaDir, 'contract.prisma'));
        expect(await runCli(['--prisma-config', 'prisma.config.ts', '--output', 'o'], deps())).toBe(0);
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('exits 1 with the `prisma contract emit` hint when contract.json is missing', async () => {
        fs.rmSync(path.join(prismaDir, 'contract.json'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await runCli(['--contract', 'src/prisma/contract.prisma'], deps())).toBe(1);
        expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/prisma contract emit/);
        expect(generate).not.toHaveBeenCalled();
    });

    it('exits 1 when an explicit --config does not exist or a step throws', async () => {
        expect(await runCli(['--contract', 'src/prisma/contract.json', '--config', 'missing.ts'], deps())).toBe(1);
        contractToDatamodel.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(await runCli(['--contract', 'src/prisma/contract.json'], deps())).toBe(1);
        expect(generate).not.toHaveBeenCalled();
    });
});
