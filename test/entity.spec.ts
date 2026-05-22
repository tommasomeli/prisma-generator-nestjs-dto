import { describe, expect, it } from 'vitest';
import EntityDtoGenerator from '../src/generators/entity-generator';
import { buildOptions } from './helpers/build-options';

describe('EntityDtoGenerator', () => {
    it('hides fields with @DtoEntityHidden / @DtoApiHidden / @DtoHidden', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'email', type: 'String', isRequired: true },
                            { name: 'password', type: 'String', isRequired: true, documentation: '@DtoHidden' },
                            { name: 'internalNote', type: 'String', isRequired: true, documentation: '@DtoEntityHidden' },
                            { name: 'apiOnlyValue', type: 'String', isRequired: true, documentation: '@DtoApiHidden' }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toContain('email');
        expect(file.content).not.toContain('password');
        expect(file.content).not.toContain('internalNote');
        expect(file.content).not.toContain('apiOnlyValue');
    });

    it('emits the entity as a class by default', async () => {
        const gen = new EntityDtoGenerator(
            buildOptions({
                models: [{ name: 'User', fields: [{ name: 'id', type: 'Int', isId: true }] }]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toMatch(/export class User /);
    });
});
