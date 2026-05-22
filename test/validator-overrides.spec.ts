import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import EntityGenerator from '../src/generators/entity-generator';
import { generate } from '../src/generator';
import { buildOptions } from './helpers/build-options';

/**
 * Any descriptor in `extraValidators` / `extraDecorators` / `extraImports` that exports
 * a name colliding with a built-in default (`class-validator`, `@nestjs/swagger`,
 * `class-transformer`, `@prisma/client`, ...) must win: the emitted DTO routes that
 * symbol through the user module instead of the default one.
 */
describe('extra* descriptors override built-in default imports', () => {
    describe('extraValidators → class-validator', () => {
        it('overrides @IsBoolean() when a custom IsBoolean is declared', async () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{
                        name: 'Toggle',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'enabled', type: 'Boolean', isRequired: true }
                        ]
                    }],
                    config: { extraValidators: 'IsBoolean:src/common/validators' }
                })
            );
            const [file] = await gen.generate();
            expect(file.content).toContain('@IsBoolean()');
            expect(file.content).toContain("import { IsBoolean } from 'src/common/validators'");
            expect(file.content).not.toMatch(/import \{[^}]*IsBoolean[^}]*\} from ['"]class-validator['"]/);
        });

        it('overrides multiple built-in decorators in one descriptor', async () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{
                        name: 'Mixed',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'name', type: 'String', isRequired: true },
                            { name: 'enabled', type: 'Boolean', isRequired: true }
                        ]
                    }],
                    config: { extraValidators: 'IsBoolean,IsString:src/common/validators' }
                })
            );
            const [file] = await gen.generate();
            expect(file.content).toMatch(/import \{[^}]*\bIsBoolean\b[^}]*\bIsString\b[^}]*\} from 'src\/common\/validators'|import \{[^}]*\bIsString\b[^}]*\bIsBoolean\b[^}]*\} from 'src\/common\/validators'/);
            expect(file.content).toMatch(/from ['"]class-validator['"]/);
            expect(file.content).not.toMatch(/import \{[^}]*IsBoolean[^}]*\} from ['"]class-validator['"]/);
            expect(file.content).not.toMatch(/import \{[^}]*IsString[^}]*\} from ['"]class-validator['"]/);
        });

        it('leaves built-in decorators alone when no override matches', async () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{
                        name: 'Toggle',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'enabled', type: 'Boolean', isRequired: true }
                        ]
                    }],
                    config: { extraValidators: 'IsUnique:src/common/validators' }
                })
            );
            const [file] = await gen.generate();
            expect(file.content).toContain('@IsBoolean()');
            expect(file.content).toMatch(/import \{[^}]*IsBoolean[^}]*\} from ['"]class-validator['"]/);
        });
    });

    describe('extraDecorators → @nestjs/swagger', () => {
        it('overrides ApiProperty when a custom ApiProperty is declared', async () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{
                        name: 'Toggle',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'name', type: 'String', isRequired: true }
                        ]
                    }],
                    config: { extraDecorators: 'ApiProperty:src/common/swagger' }
                })
            );
            const [file] = await gen.generate();
            expect(file.content).toContain('@ApiProperty(');
            expect(file.content).toContain("import { ApiProperty } from 'src/common/swagger'");
            expect(file.content).not.toMatch(/import \{[^}]*ApiProperty[^}]*\} from ['"]@nestjs\/swagger['"]/);
        });
    });

    describe('extraImports → @prisma/client', () => {
        it('overrides Prisma import when a custom Prisma is declared', async () => {
            const gen = new EntityGenerator(
                buildOptions({
                    models: [{
                        name: 'Doc',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'data', type: 'Json', isRequired: true }
                        ]
                    }],
                    config: { extraImports: 'Prisma:src/common/prisma' }
                })
            );
            const [file] = await gen.generate();
            expect(file.content).toContain("import { Prisma } from 'src/common/prisma'");
            expect(file.content).not.toMatch(/import \{[^}]*\bPrisma\b[^}]*\} from ['"]@prisma\/client['"]/);
        });
    });

    describe('extraGenerators → built-in generator slot', () => {
        let outDir: string;

        beforeEach(() => {
            outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-gen-override-'));
        });

        afterEach(() => {
            fs.rmSync(outDir, { recursive: true, force: true });
        });

        it('replaces the built-in CreateDtoGenerator when an extraGenerator exports the same name', async () => {
            const pluginPath = path.join(outDir, 'plugin.cjs');
            const sentinel = '// SENTINEL: produced by the override plugin';
            fs.writeFileSync(
                pluginPath,
                `class CreateDtoGenerator {
                    constructor(options) { this.options = options; }
                    generate() {
                        const out = this.options.generator.output.value;
                        return Promise.resolve([{ path: out + '/create-stub.dto.ts', content: ${JSON.stringify(sentinel)} }]);
                    }
                    getPath() { return ''; }
                }
                module.exports = { CreateDtoGenerator };`
            );

            const genOut = path.join(outDir, 'generated');
            await generate(
                buildOptions({
                    output: genOut,
                    models: [{ name: 'Toggle', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                    config: {
                        extraGenerators: `CreateDtoGenerator:${pluginPath}`,
                        outputStructure: 'flat',
                        reExport: 'false',
                        prettier: 'false'
                    }
                })
            );

            const stub = fs.readFileSync(path.join(genOut, 'create-stub.dto.ts'), 'utf8');
            expect(stub).toContain(sentinel);
            expect(fs.existsSync(path.join(genOut, 'create-toggle.dto.ts'))).toBe(false);
        });
    });
});
