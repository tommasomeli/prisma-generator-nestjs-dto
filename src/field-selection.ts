import {
    DTO_CREATE_HIDDEN,
    DTO_CREATE_OPTIONAL,
    DTO_CREATE_REQUIRED,
    DTO_CREATED_AT,
    DTO_HIDDEN,
    DTO_UPDATE_HIDDEN,
    DTO_UPDATE_OPTIONAL,
    DTO_UPDATE_REQUIRED,
    isEntityHidden
} from './annotations';
import { Field, Model } from './types';

const has = (field: Field, name: string): boolean => field.annotations.some((a) => a.name === name);

/** Scalar foreign keys backing a relation (`authorId` for `author @relation(fields: [authorId])`). */
const isRelationScalar = (model: Model, field: Field): boolean => model.fields.some((f) => f.relationFromFields?.includes?.(field.name));

/**
 * Fields of the Create DTO/schema, cloned with `isRequired` / `isNullable` adjusted for
 * `@DtoCreateOptional` / `@DtoCreateRequired`. Drops ids, `@updatedAt`, `@createdAt`,
 * relation foreign keys and `@DtoHidden` / `@DtoCreateHidden` fields.
 *
 * @param model Source model.
 * @return Processed field clones.
 */
export function selectCreateFields(model: Model): Field[] {
    return model.fields
        .filter((field) => {
            if (has(field, DTO_HIDDEN) || has(field, DTO_CREATE_HIDDEN) || has(field, DTO_CREATED_AT)) return false;
            if (isRelationScalar(model, field)) return false;
            return !field.isId && !field.isUpdatedAt;
        })
        .map((f) => {
            const field = { ...f, annotations: [...f.annotations] };
            if (has(field, DTO_CREATE_OPTIONAL)) {
                field.isRequired = false;
                field.isNullable = true;
            }
            if (has(field, DTO_CREATE_REQUIRED)) field.isRequired = true;
            return field;
        });
}

/**
 * Fields of the Update DTO/schema: the id stays required, everything else becomes optional
 * unless `@DtoUpdateRequired`. Drops `@updatedAt`, `@createdAt`, relation foreign keys and
 * `@DtoHidden` / `@DtoUpdateHidden` fields.
 *
 * @param model Source model.
 * @return Processed field clones.
 */
export function selectUpdateFields(model: Model): Field[] {
    return model.fields
        .filter((field) => {
            if (has(field, DTO_HIDDEN) || has(field, DTO_UPDATE_HIDDEN) || has(field, DTO_CREATED_AT)) return false;
            if (isRelationScalar(model, field)) return false;
            if (field.isId) return true;
            return !field.isUpdatedAt;
        })
        .map((f) => {
            const field = { ...f, annotations: [...f.annotations] };
            field.isRequired = field.isId ? true : false;
            if (has(field, DTO_UPDATE_OPTIONAL)) {
                field.isRequired = false;
                field.isNullable = true;
            }
            if (has(field, DTO_UPDATE_REQUIRED)) field.isRequired = true;
            return field;
        });
}

/**
 * Fields of the Entity DTO/schema (API response shape): everything except
 * `@DtoHidden` / `@DtoEntityHidden` / `@DtoApiHidden` fields.
 *
 * @param model Source model.
 * @return Visible fields (not cloned).
 */
export function selectEntityFields(model: Model): Field[] {
    return model.fields.filter((field) => !isEntityHidden(field));
}
