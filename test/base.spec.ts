import { describe, expect, it } from 'vitest';
import EntityDtoGenerator from '../src/generators/entity-generator';
import { buildOptions } from './helpers/build-options';

describe('BaseGenerator', () => {
    it('parses parameterless annotations from documentation', () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'email', type: 'String', isRequired: true, documentation: '@DtoReadOnly' }
                        ]
                    }
                ]
            })
        );
        const email = gen.models[0].fields.find((f) => f.name === 'email')!;
        expect(email.annotations.map((a) => a.name)).toContain('DtoReadOnly');
    });

    it('parses annotations with positional params', () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'age', type: 'Int', documentation: '@DtoOverrideType(string)' }
                        ]
                    }
                ]
            })
        );
        const age = gen.models[0].fields.find((f) => f.name === 'age')!;
        const override = age.annotations.find((a) => a.name === 'DtoOverrideType');
        expect(override).toBeDefined();
        expect(override!.params).toEqual(['string']);
    });

    it('filters models marked with @DtoIgnoreModel', () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    { name: 'User', fields: [{ name: 'id', type: 'Int', isId: true }] },
                    { name: 'Internal', documentation: '@DtoIgnoreModel', fields: [{ name: 'id', type: 'Int', isId: true }] }
                ]
            })
        );
        expect(gen.models.map((m) => m.name)).toEqual(['User']);
    });

    it('honors fileNamingStrategy when computing paths', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [{ name: 'UserAccount', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'nestjs' }
            })
        );
        const files = await gen.generate();
        expect(files[0].path).toContain('user-account/user-account.entity.ts');
    });
});
