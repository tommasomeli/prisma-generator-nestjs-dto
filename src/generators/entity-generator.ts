import { isEntityHidden } from '../annotations';
import { BaseGenerator } from '../base-generator';
import { Field, File, Model } from '../types';

export default class EntityDtoGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.entity';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models.map((model) => {
            const filteredFields = model.fields.filter((field: Field) => !isEntityHidden(field));
            const processedModel: Model = { ...model, fields: filteredFields as Field[] };
            const outputPath = this.getPath(model);
            return {
                path: outputPath,
                content: this.getTemplate({ model: processedModel, classValidator: false, outputPath })
            };
        });
    }
}
