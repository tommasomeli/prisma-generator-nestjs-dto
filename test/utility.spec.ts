import { describe, expect, it } from 'vitest';
import { Utility } from '../src/utility';

describe('Utility.parseImports', () => {
    describe('inline syntax', () => {
        it('parses a single named entry', () => {
            expect(Utility.parseImports('IsUnique:src/common/validators')).toEqual([
                { from: 'src/common/validators', destruct: ['IsUnique'] }
            ]);
        });

        it('parses comma-separated names on the same path', () => {
            expect(Utility.parseImports('IsUnique,IsImage,IsBool:src/common/validators')).toEqual([
                { from: 'src/common/validators', destruct: ['IsUnique', 'IsImage', 'IsBool'] }
            ]);
        });

        it('parses a namespace import', () => {
            expect(Utility.parseImports('* as CONSTANTS:src/common/constants')).toEqual([
                { from: 'src/common/constants', alias: '* as CONSTANTS' }
            ]);
        });

        it('parses a default import', () => {
            expect(Utility.parseImports('default as IsAdult:src/common/validators/is-adult')).toEqual([
                { from: 'src/common/validators/is-adult', alias: 'default as IsAdult' }
            ]);
        });

        it('parses pipe-separated groups across different paths', () => {
            expect(Utility.parseImports('* as CONSTANTS:src/common/constants|i18nValidationMessage:nestjs-i18n')).toEqual([
                { from: 'src/common/constants', alias: '* as CONSTANTS' },
                { from: 'nestjs-i18n', destruct: ['i18nValidationMessage'] }
            ]);
        });

        it('parses an array of inline groups', () => {
            expect(
                Utility.parseImports([
                    'IsUnique,IsBool:src/common/validators',
                    'default as IsAdult:src/common/validators/is-adult',
                    '* as CONSTANTS:src/common/constants'
                ])
            ).toEqual([
                { from: 'src/common/validators', destruct: ['IsUnique', 'IsBool'] },
                { from: 'src/common/validators/is-adult', alias: 'default as IsAdult' },
                { from: 'src/common/constants', alias: '* as CONSTANTS' }
            ]);
        });

        it('merges multiple named imports targeting the same path', () => {
            expect(
                Utility.parseImports(['IsUnique:src/common/validators', 'IsBool,IsImage:src/common/validators'])
            ).toEqual([{ from: 'src/common/validators', destruct: ['IsUnique', 'IsBool', 'IsImage'] }]);
        });
    });

    describe('edge cases', () => {
        it('returns an empty array for undefined / empty input', () => {
            expect(Utility.parseImports(undefined)).toEqual([]);
            expect(Utility.parseImports('')).toEqual([]);
            expect(Utility.parseImports([])).toEqual([]);
        });

        it('skips ES import syntax with a warning instead of parsing it', () => {
            expect(Utility.parseImports("import { IsUnique } from 'src/common/validators'")).toEqual([]);
        });

        it('skips entries missing a path after the colon', () => {
            expect(Utility.parseImports('IsUnique')).toEqual([]);
        });
    });

    describe('stringToImports (deprecated alias)', () => {
        it('delegates to parseImports', () => {
            expect(Utility.stringToImports('IsUnique:src/common/validators')).toEqual([
                { from: 'src/common/validators', destruct: ['IsUnique'] }
            ]);
        });
    });
});
