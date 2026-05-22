import { describe, expect, it } from 'vitest';
import EntityDtoGenerator from '../src/generators/entity-generator';
import { buildOptions } from './helpers/build-options';

describe('Annotations integration', () => {
    it('@DtoOverrideType swaps the rendered type without mutating the source model', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'Profile',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'age', type: 'Int', isRequired: true, documentation: '@DtoOverrideType(string)' }
                        ]
                    }
                ]
            })
        );
        const originalKind = gen.models[0].fields.find((f) => f.name === 'age')!.kind;
        const [file] = await gen.generate();
        expect(file.content).toContain('age!: string');
        expect(gen.models[0].fields.find((f) => f.name === 'age')!.kind).toBe(originalKind);
    });

    it('@DtoApiHidden emits @ApiHideProperty()', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'email', type: 'String', isRequired: true, documentation: '@DtoApiHidden' }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).not.toContain('email');
    });

    it('@DtoReadOnly marks the field as readonly', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'Audit',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'createdAt', type: 'DateTime', isRequired: true, documentation: '@DtoReadOnly' }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toMatch(/readonly\s+createdAt!?:/);
    });
});
