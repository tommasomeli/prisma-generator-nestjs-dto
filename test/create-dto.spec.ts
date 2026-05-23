import { describe, expect, it } from 'vitest';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import { buildOptions } from './helpers/build-options';

describe('CreateDtoGenerator', () => {
    it('omits id, updatedAt, createdAt and relation FK fields', async () => {
        const gen = new CreateDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'Post',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'title', type: 'String', isRequired: true },
                            { name: 'createdAt', type: 'DateTime', documentation: '@createdAt' },
                            { name: 'updatedAt', type: 'DateTime', isUpdatedAt: true },
                            { name: 'authorId', type: 'Int', isRequired: true },
                            { name: 'author', type: 'User', kind: 'object', isRequired: true, relationFromFields: ['authorId'] }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toContain('title');
        expect(file.content).not.toMatch(/\bid\??:/);
        expect(file.content).not.toContain('createdAt');
        expect(file.content).not.toContain('updatedAt');
        expect(file.content).not.toMatch(/authorId\??:/);
    });

    it('honors @DtoCreateHidden and @DtoCreateOptional', async () => {
        const gen = new CreateDtoGenerator(
            buildOptions({
                models: [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'email', type: 'String', isRequired: true },
                            { name: 'password', type: 'String', isRequired: true, documentation: '@DtoCreateHidden' },
                            { name: 'nickname', type: 'String', isRequired: true, documentation: '@DtoCreateOptional' }
                        ]
                    }
                ]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).not.toContain('password');
        expect(file.content).toMatch(/nickname\?\s*:/);
    });

    it('uses the Create<Model>Dto class name', async () => {
        const gen = new CreateDtoGenerator(
            buildOptions({
                models: [{ name: 'User', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'email', type: 'String', isRequired: true }] }]
            })
        );
        const [file] = await gen.generate();
        expect(file.content).toMatch(/export class CreateUserDto /);
    });
});
