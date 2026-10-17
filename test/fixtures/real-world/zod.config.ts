import { from, fromNamespace } from '../../../src/config-loader';
import type { GeneratorConfigFile } from '../../../src/types';

export default {
    extraValidators: from('src/common/validators', ['IsUnique', 'IsImage', 'IsBoolean']),
    extraImports: [
        fromNamespace('./shared/constants', 'CONSTANTS'),
        from('nestjs-i18n', 'i18nValidationMessage'),
        from('./shared/media-formats', 'MediaFormatsSchema')
    ],
    extraDecorators: from('src/common/decorators/many-to-many.decorator', 'ManyToMany')
} satisfies GeneratorConfigFile;
