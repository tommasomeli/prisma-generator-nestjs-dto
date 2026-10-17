import { DTO_UPDATE_VALIDATE_IF } from '../annotations';
import { BaseGenerator } from '../base-generator';
import { selectUpdateFields } from '../field-selection';
import { File } from '../types';

export default class UpdateDtoGenerator extends BaseGenerator {
    filePrefix = 'update-';
    fileSuffix = '.dto';
    classPrefix = 'Update';
    classSuffix = 'Dto';

    async generate(): Promise<File[]> {
        return this.models.map((model) => {
            const processedFields = selectUpdateFields(model).map((field) => {
                const validateIfAnnotation = field.annotations.find((a) => a.name === DTO_UPDATE_VALIDATE_IF);
                if (validateIfAnnotation && validateIfAnnotation.params && validateIfAnnotation.params.length > 0) {
                    const validateIfParams = validateIfAnnotation.params.join(', ');
                    field.annotations.push({ name: 'ValidateIf', params: [validateIfParams] });
                }
                return field;
            });
            const processedModel = { ...model, fields: processedFields };
            const outputPath = this.getPath(model);
            return {
                path: outputPath,
                content: this.getTemplate({ model: processedModel, outputPath })
            };
        });
    }
}
