import { describe, expect, it } from 'vitest';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import { Utility } from '../src/utility';
import { buildOptions } from './helpers/build-options';

/**
 * `extraAnnotations` lets plugin authors register annotation names they react to in their
 * custom sub-generators. The base parser already extracts any `@Name` from `///` comments,
 * so registration is mainly discovery: the parsed list is exposed via `config.extraAnnotations`
 * and the new `BaseGenerator#getAnnotation` / `hasAnnotation` helpers operate on every
 * annotation a field/model carries.
 */
describe('extraAnnotations + annotation helpers', () => {
    describe('Utility.parseAnnotationNames', () => {
        it('parses a comma-separated string', () => {
            expect(Utility.parseAnnotationNames('DtoFoo, DtoBar')).toEqual(['DtoFoo', 'DtoBar']);
        });

        it('parses an array of strings', () => {
            expect(Utility.parseAnnotationNames(['DtoFoo', 'DtoBar'])).toEqual(['DtoFoo', 'DtoBar']);
        });

        it('strips leading @ and dedupes', () => {
            expect(Utility.parseAnnotationNames('@DtoFoo, @DtoBar, DtoFoo')).toEqual(['DtoFoo', 'DtoBar']);
        });

        it('returns [] when undefined', () => {
            expect(Utility.parseAnnotationNames(undefined)).toEqual([]);
        });

        it('handles mixed array entries with whitespace and commas inside', () => {
            expect(Utility.parseAnnotationNames(['DtoFoo DtoBar', '@DtoBaz'])).toEqual(['DtoFoo', 'DtoBar', 'DtoBaz']);
        });
    });

    describe('config exposes extraAnnotations to generators', () => {
        it('populates config.extraAnnotations from the raw config', () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                    config: { extraAnnotations: '@DtoFoo, DtoBar' }
                })
            );
            expect(gen['config'].extraAnnotations).toEqual(['DtoFoo', 'DtoBar']);
        });

        it('defaults to an empty list when extraAnnotations is missing', () => {
            const gen = new CreateDtoGenerator(buildOptions({ models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }] }));
            expect(gen['config'].extraAnnotations).toEqual([]);
        });
    });

    describe('BaseGenerator#getAnnotation / hasAnnotation', () => {
        it('returns the parsed annotation including its params on a field', () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{
                        name: 'Post',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'title', type: 'String', isRequired: true, documentation: '@DtoMyCustom(42, hello)' }
                        ]
                    }],
                    config: { extraAnnotations: 'DtoMyCustom' }
                })
            );
            const post = gen.models.find((m) => m.name === 'Post')!;
            const title = post.fields.find((f) => f.name === 'title')!;
            const annotation = gen.getAnnotation(title, 'DtoMyCustom');
            expect(annotation).toBeDefined();
            expect(annotation!.name).toBe('DtoMyCustom');
            expect(annotation!.params).toEqual([42, 'hello']);
            expect(gen.hasAnnotation(title, 'DtoMyCustom')).toBe(true);
            expect(gen.hasAnnotation(title, 'DtoOther')).toBe(false);
        });

        it('returns undefined / false for fields with no documentation', () => {
            const gen = new CreateDtoGenerator(
                buildOptions({ models: [{ name: 'Bare', fields: [{ name: 'id', type: 'Int', isId: true }] }] })
            );
            const bare = gen.models.find((m) => m.name === 'Bare')!;
            const id = bare.fields.find((f) => f.name === 'id')!;
            expect(gen.getAnnotation(id, 'DtoNope')).toBeUndefined();
            expect(gen.hasAnnotation(id, 'DtoNope')).toBe(false);
        });

        it('also resolves annotations declared at model level', () => {
            const gen = new CreateDtoGenerator(
                buildOptions({
                    models: [{ name: 'Tagged', documentation: '@DtoTag', fields: [{ name: 'id', type: 'Int', isId: true }] }]
                })
            );
            const tagged = gen.models.find((m) => m.name === 'Tagged')!;
            expect(gen.hasAnnotation(tagged, 'DtoTag')).toBe(true);
        });
    });
});
