import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import { BaseGenerator } from './base-generator';
import { applyConfigFile, loadConfigFile } from './config-loader';
import { CreateDtoGenerator, EntityGenerator, ManifestGenerator, UpdateDtoGenerator } from './generators';
import { GeneratorOptions, RawGeneratorConfig } from './types';
import { Utility } from './utility';

/**
 * Built-in generators that always participate in the pipeline. The iteration order
 * matters: it determines the order of `export *` statements emitted in per-model
 * `index.ts` barrels.
 */
const BuiltInGenerators = { CreateDtoGenerator, EntityGenerator, UpdateDtoGenerator };

/** Constructor signature shared by every concrete generator extending `BaseGenerator`. */
type GeneratorCtor = new (options: GeneratorOptions) => BaseGenerator;

/**
 * Resolves Prettier config once for the whole run. Returns `null` if Prettier
 * is disabled or unavailable so the caller can skip formatting cleanly.
 */
async function resolvePrettierConfig(enabled: boolean): Promise<prettier.Options | null> {
    if (!enabled) return null;
    try {
        const prettierConfigFile = await prettier.resolveConfigFile();
        let config: prettier.Options = {};
        if (!prettierConfigFile) {
            Utility.log('Stylizing output DTOs with the default Prettier config.');
        } else {
            Utility.log(`Stylizing output DTOs with found Prettier config. (${prettierConfigFile})`);
            const resolved = await prettier.resolveConfig(prettierConfigFile, { config: prettierConfigFile });
            if (resolved) config = resolved;
        }
        config.parser = 'typescript';
        return config;
    } catch (error) {
        Utility.warn('Failed to resolve Prettier config:', error);
        return null;
    }
}

/** TypeScript-aware extensions: handled via jiti instead of plain `require`. */
const TS_PLUGIN_EXTENSIONS = new Set(['.ts', '.cts', '.mts', '.tsx']);

/**
 * Loads a plugin module from disk. Routes `.ts` / `.cts` / `.mts` / `.tsx` paths
 * through [`jiti`](https://github.com/unjs/jiti) so users do not have to precompile,
 * and falls back to the native `require` for everything else.
 */
async function importPluginModule(absolutePath: string): Promise<Record<string, unknown>> {
    const ext = path.extname(absolutePath).toLowerCase();
    if (TS_PLUGIN_EXTENSIONS.has(ext)) {
        const { createJiti } = await import('jiti');
        const jiti = createJiti(absolutePath, { interopDefault: true, moduleCache: false });
        const mod = (await jiti.import(absolutePath)) as Record<string, unknown> | { default?: Record<string, unknown> };
        if (mod && typeof mod === 'object' && 'default' in mod && mod.default && typeof mod.default === 'object') {
            return { ...(mod.default as Record<string, unknown>), ...(mod as Record<string, unknown>) };
        }
        return mod as Record<string, unknown>;
    }
    return require(absolutePath);
}

/** Dynamically loads `extraGenerators` provided via the `extraGenerators` config option. */
async function loadExtraGenerators(options: GeneratorOptions): Promise<Record<string, GeneratorCtor>> {
    const extra: Record<string, GeneratorCtor> = {};
    const raw = (options.generator.config as RawGeneratorConfig).extraGenerators;
    if (!raw) return extra;
    try {
        const imports = Utility.parseImports(raw);
        for (const importInfo of imports) {
            try {
                const modulePath = path.isAbsolute(importInfo.from) ? importInfo.from : path.resolve(process.cwd(), importInfo.from);
                const importedModule = await importPluginModule(modulePath);
                if (importInfo.destruct && importInfo.destruct.length > 0) {
                    for (const generatorName of importInfo.destruct) {
                        if (importedModule[generatorName]) {
                            extra[generatorName] = importedModule[generatorName] as GeneratorCtor;
                            Utility.log(`Loaded generator ${generatorName} from ${importInfo.from}`);
                        } else {
                            Utility.warn(`Generator ${generatorName} not found in ${importInfo.from}`);
                        }
                    }
                } else if (importInfo.alias) {
                    extra[importInfo.alias] = importedModule as unknown as GeneratorCtor;
                    Utility.log(`Loaded generator ${importInfo.alias} from ${importInfo.from}`);
                } else {
                    Object.entries(importedModule).forEach(([name, exported]) => {
                        extra[name] = exported as GeneratorCtor;
                        Utility.log(`Loaded generator ${name} from ${importInfo.from}`);
                    });
                }
            } catch (error) {
                Utility.error(`Failed to load generators from ${importInfo.from}:`, error);
            }
        }
    } catch (error) {
        Utility.error(`Failed to parse extraGenerators:`, error);
    }
    return extra;
}

/**
 * Instantiates a registry of generator constructors, skipping invalid entries with a warning.
 * Duck-typing is intentional: plugins loaded from a separately-bundled copy of this package
 * fail an `instanceof BaseGenerator` check even though they are structurally compatible.
 */
function instantiateGenerators(registry: Record<string, unknown>, options: GeneratorOptions): BaseGenerator[] {
    return Object.entries(registry)
        .map(([name, Ctor]) => {
            try {
                if (typeof Ctor !== 'function') {
                    Utility.warn(`Skipping ${name}: not a constructor function`);
                    return null;
                }
                const instance = new (Ctor as GeneratorCtor)(options);
                if (typeof (instance as BaseGenerator).generate === 'function' && typeof (instance as BaseGenerator).getPath === 'function') return instance as BaseGenerator;
                Utility.warn(`Skipping ${name}: not a BaseGenerator-shaped object (missing generate/getPath)`);
            } catch (error) {
                Utility.error(`Error initializing generator ${name}:`, error);
            }
            return null;
        })
        .filter((instance): instance is BaseGenerator => instance !== null);
}

/** Optionally formats `content` with Prettier; falls back to the original content on failure. */
async function maybeFormat(content: string, config: prettier.Options | null, label: string): Promise<string> {
    if (!config) return content;
    try {
        return await prettier.format(content, config);
    } catch (error) {
        Utility.warn(`Failed to format ${label} with Prettier:`, error);
        return content;
    }
}

/**
 * Entry point used by `@prisma/generator-helper`. Executes every registered
 * generator (built-in + user-provided), writes the resulting files to disk
 * and, when enabled, emits `index.ts` barrels for re-exports.
 */
export async function generate(options: GeneratorOptions): Promise<void> {
    const outputDir = options.generator.output?.value;
    if (!outputDir) {
        Utility.error('Output directory is not set. Add `output = "..."` to the generator block in schema.prisma.');
        return;
    }

    const externalConfig = await loadConfigFile(options);
    const mergedConfig = applyConfigFile(options.generator.config as RawGeneratorConfig, externalConfig?.config ?? null, externalConfig?.dir);
    (options.generator as { config: RawGeneratorConfig }).config = mergedConfig;
    const rawConfig = mergedConfig;

    const extraGenerators = await loadExtraGenerators(options);
    const allGenerators = { ...BuiltInGenerators, ...extraGenerators };
    const generators = instantiateGenerators(allGenerators, options);

    // Make every generator instance share the same `models` reference so that
    // mutations done by one plugin's `beforeAll` are visible to every later
    // `beforeAll` and to every `generate()` call.
    const sharedModels = generators[0]?.models ?? [];
    for (const generator of generators) generator.models = sharedModels;

    const applyPrettier = Utility.parseBoolean(typeof rawConfig.prettier === 'string' ? rawConfig.prettier : undefined);
    const prettierConfig = await resolvePrettierConfig(applyPrettier);
    const outputStructure = typeof rawConfig.outputStructure === 'string' ? rawConfig.outputStructure : 'nestjs';

    for (const generator of generators) {
        try {
            await generator.beforeAll(sharedModels);
        } catch (error) {
            Utility.error(`Error in ${generator.constructor.name}#beforeAll:`, error);
        }
    }

    const exports: Record<string, string> = {};
    const emittedFiles: { path: string; content: string }[] = [];
    const persistFile = async (file: { path: string; content: string }, label: string): Promise<void> => {
        const content = await maybeFormat(file.content, prettierConfig, label);
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        fs.writeFileSync(file.path, content);
        const exportPath = outputStructure === 'flat' ? file.path : path.dirname(file.path);
        const exportLine = `export * from './${path.basename(file.path).replace('.ts', '')}';`;
        exports[exportPath] = exports[exportPath] ? `${exports[exportPath]}\n${exportLine}` : exportLine;
        emittedFiles.push(file);
    };

    for (const generator of generators) {
        try {
            Utility.log(`Executing generator: ${generator.constructor.name}`);
            const files = await generator.generate();
            for (const file of files) await persistFile(file, path.basename(file.path));
        } catch (error) {
            Utility.error(`Error while executing ${generator.constructor.name}:`, error);
        }
    }

    for (const generator of generators) {
        try {
            const extra = await generator.afterAll(emittedFiles);
            if (Array.isArray(extra)) for (const file of extra) await persistFile(file, path.basename(file.path));
        } catch (error) {
            Utility.error(`Error in ${generator.constructor.name}#afterAll:`, error);
        }
    }

    if (Utility.parseBoolean(typeof rawConfig.reExport === 'string' ? rawConfig.reExport : undefined)) {
        if (outputStructure !== 'flat') {
            for (const [exportPath, content] of Object.entries(exports)) {
                const indexContent = await maybeFormat(content, prettierConfig, 'index file');
                fs.writeFileSync(`${exportPath}/index.ts`, indexContent);
            }
        }
        const mainIndexContent = await maybeFormat(
            Object.keys(exports)
                .map((exportPath) => `export * from './${path.basename(exportPath).replace('.ts', '')}';`)
                .join('\n'),
            prettierConfig,
            'main index file'
        );
        fs.writeFileSync(`${outputDir}/index.ts`, mainIndexContent);
    }

    if (Utility.parseBoolean(typeof rawConfig.emitManifest === 'string' ? rawConfig.emitManifest : undefined)) {
        const manifestFiles = await new ManifestGenerator(options).generate();
        for (const file of manifestFiles) {
            const content = await maybeFormat(file.content, prettierConfig, path.basename(file.path));
            fs.writeFileSync(file.path, content);
        }
    }
}
