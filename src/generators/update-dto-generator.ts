import { DTO_CREATED_AT, DTO_HIDDEN, DTO_UPDATE_HIDDEN, DTO_UPDATE_OPTIONAL, DTO_UPDATE_REQUIRED, DTO_UPDATE_VALIDATE_IF } from '../annotations';
import { BaseGenerator } from '../base-generator';
import { Field, File } from '../types';

export default class UpdateDtoGenerator extends BaseGenerator {
    filePrefix = 'update-';
    fileSuffix = '.dto';
    classPrefix = 'Update';
    classSuffix = 'Dto';

    async generate(): Promise<File[]> {
        return this.models.map((model) => {
            const filteredFields = model.fields.filter((field: Field) => {
                if (field.annotations.some((a) => a.name === DTO_HIDDEN)) return false;
                if (field.annotations.some((a) => a.name === DTO_UPDATE_HIDDEN)) return false;
                if (field.annotations.some((a) => a.name === DTO_CREATED_AT)) return false;
                const isRelationField = model.fields.some((f) => f.relationFromFields?.includes?.(field.name));
                if (isRelationField) return false;
                if (field.isId) return true;
                if (field.isUpdatedAt) return false;
                return true;
            });
            const processedFields = filteredFields.map((f: Field) => {
                const field = { ...f, annotations: [...f.annotations] };
                field.isRequired = field.isId ? true : false;
                if (field.annotations.some((a) => a.name === DTO_UPDATE_OPTIONAL)) {
                    field.isRequired = false;
                    field.isNullable = true;
                }
                if (field.annotations.some((a) => a.name === DTO_UPDATE_REQUIRED)) field.isRequired = true;
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
