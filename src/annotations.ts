import type { Annotation } from './types';

// Model level annotations
export const DTO_IGNORE_MODEL = 'DtoIgnoreModel';
export const DTO_API_EXTRA_MODELS = 'DtoApiExtraModels';

// Field visibility annotations
export const DTO_READ_ONLY = 'DtoReadOnly';
export const DTO_CREATE_HIDDEN = 'DtoCreateHidden';
export const DTO_UPDATE_HIDDEN = 'DtoUpdateHidden';
export const DTO_ENTITY_HIDDEN = 'DtoEntityHidden';
export const DTO_API_HIDDEN = 'DtoApiHidden';
export const DTO_HIDDEN = 'DtoHidden';
export const DTO_CREATED_AT = 'createdAt';

// Field requirement annotations
export const DTO_CREATE_OPTIONAL = 'DtoCreateOptional';
export const DTO_CREATE_REQUIRED = 'DtoCreateRequired';
export const DTO_UPDATE_OPTIONAL = 'DtoUpdateOptional';
export const DTO_UPDATE_REQUIRED = 'DtoUpdateRequired';

// Type handling annotations
export const DTO_OVERRIDE_TYPE = 'DtoOverrideType';
export const DTO_OVERRIDE_API_PROPERTY_TYPE = 'DtoOverrideApiPropertyType';

// Validation annotations
export const DTO_CREATE_VALIDATE_IF = 'DtoCreateValidateIf';
export const DTO_UPDATE_VALIDATE_IF = 'DtoUpdateValidateIf';

/** Annotations that hide a field from the Entity DTO surface (and therefore from API responses). */
export const ENTITY_HIDDEN_ANNOTATIONS = [DTO_HIDDEN, DTO_ENTITY_HIDDEN, DTO_API_HIDDEN];
const ENTITY_HIDDEN_SET = new Set(ENTITY_HIDDEN_ANNOTATIONS);

/** Accepts both parsed annotations and raw `documentation` strings (used pre-pipeline). */
export function isEntityHidden(field: { annotations?: Annotation[]; documentation?: string | null }): boolean {
    if (field.annotations) return field.annotations.some((a) => ENTITY_HIDDEN_SET.has(a.name));
    if (!field.documentation) return false;
    return ENTITY_HIDDEN_ANNOTATIONS.some((name) => new RegExp(`@${name}\\b`).test(field.documentation as string));
}
