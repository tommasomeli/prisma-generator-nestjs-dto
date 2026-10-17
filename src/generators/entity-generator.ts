import { BaseGenerator } from '../base-generator';
import { selectEntityFields } from '../field-selection';
import { File, Model } from '../types';

export default class EntityDtoGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.entity';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models.map((model) => {
            const processedModel: Model = { ...model, fields: selectEntityFields(model) };
            const outputPath = this.getPath(model);
            return {
                path: outputPath,
                content: this.getTemplate({ model: processedModel, classValidator: false, outputPath })
            };
        });
    }
}
