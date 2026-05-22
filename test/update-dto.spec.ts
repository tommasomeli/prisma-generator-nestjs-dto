import { describe, expect, it } from 'vitest';
import UpdateDtoGenerator from '../src/generators/update-dto-generator';
import { buildOptions } from './helpers/build-options';

describe('UpdateDtoGenerator', () => {
    it('keeps the id as required and makes everything else optional', async () => {
        const gen = new UpdateDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'email', type: 'String', isRequired: true },
                            { name: 'nickname', type: 'String', isRequired: false }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toMatch(/id!:/);
        expect(file.content).toMatch(/email\?\s*:/);
        expect(file.content).toMatch(/nickname\?\s*:/);
    });

    it('respects @DtoUpdateRequired and @DtoUpdateHidden', async () => {
        const gen = new UpdateDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'email', type: 'String', isRequired: true, documentation: '@DtoUpdateRequired' },
                            { name: 'token', type: 'String', isRequired: true, documentation: '@DtoUpdateHidden' }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toMatch(/email!:/);
        expect(file.content).not.toContain('token');
    });
});
