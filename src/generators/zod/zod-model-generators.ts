import { selectCreateFields, selectEntityFields, selectUpdateFields } from '../../field-selection';
import { File } from '../../types';
import { ZodBaseGenerator, ZodSchemaKind } from './zod-base-generator';

/** Emits `<Model>Schema` (API response / read shape) plus the inferred `<Model>` type. */
export class EntityZodGenerator extends ZodBaseGenerator {
    readonly schemaKind: ZodSchemaKind = 'entity';
    filePrefix = '';
    fileSuffix = '.schema';
    classPrefix = '';
    classSuffix = 'Schema';

    async generate(): Promise<File[]> {
        return this.models.map((model) => this.renderModel(model, selectEntityFields(model)));
    }
}

/** Emits `Create<Model>Schema` plus the `Create<Model>` (input) / `Create<Model>Output` types. */
export class CreateZodGenerator extends ZodBaseGenerator {
    readonly schemaKind: ZodSchemaKind = 'create';
    filePrefix = 'create-';
    fileSuffix = '.schema';
    classPrefix = 'Create';
    classSuffix = 'Schema';

    async generate(): Promise<File[]> {
        return this.models.map((model) => this.renderModel(model, selectCreateFields(model)));
    }
}

/** Emits `Update<Model>Schema` plus the `Update<Model>` (input) / `Update<Model>Output` types. */
export class UpdateZodGenerator extends ZodBaseGenerator {
    readonly schemaKind: ZodSchemaKind = 'update';
    filePrefix = 'update-';
    fileSuffix = '.schema';
    classPrefix = 'Update';
    classSuffix = 'Schema';

    async generate(): Promise<File[]> {
        return this.models.map((model) => this.renderModel(model, selectUpdateFields(model)));
    }
}
