import type { GeneratorConfigFile } from '../../src/types';

export default {
    extraValidators: 'IsUnique:src/common/validators',
    extraImports: ['* as CONSTANTS:src/common/constants', 'i18nValidationMessage:nestjs-i18n'],
    extraDecorators: 'ManyToMany:src/common/decorators/many-to-many.decorator'
} satisfies GeneratorConfigFile;
