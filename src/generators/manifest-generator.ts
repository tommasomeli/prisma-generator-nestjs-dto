import { isEntityHidden } from '../annotations';
import { BaseGenerator } from '../base-generator';
import { Field, File } from '../types';

/**
 * Emits runtime-side artifacts that the Prisma DMMF does not surface directly:
 *
 * - `manifest.ts`: per-model `primaryKey`, `entityFields` (mirrors `isEntityHidden`)
 *   and `relations.{type,isList}`. Useful for select builders, audit logs, etc.
 * - `model-entity-map.ts`: a type-only map `Prisma.ModelName -> generated Entity class`,
 *   handy for typing dynamic `select` paths.
 *
 * Opt-in via the `emitManifest` config option (defaults to `false`). In Zod mode and in Prisma 8
 * mode (no `@prisma/client`) the `ModelName` union is inlined. Prisma 8 value objects are not
 * models: they are left out of both files and of the `relations` of their parents.
 */
export default class ManifestGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        const map: Record<string, { primaryKey: string; entityFields: string[]; relations: Record<string, { type: string; isList: boolean }> }> = {};
        const models = this.models.filter((m) => !m.isValueObject);
        const valueObjectNames = new Set(this.models.filter((m) => m.isValueObject).map((m) => m.name));
        for (const model of models) {
            const relations: Record<string, { type: string; isList: boolean }> = {};
            for (const f of model.fields as Field[]) {
                if (f.kind !== 'object' || valueObjectNames.has(f.type)) continue;
                relations[f.name] = { type: f.type, isList: Boolean(f.isList) };
            }
            map[model.name] = {
                primaryKey: model.fields.find((f: Field) => f.isId)?.name || 'id',
                entityFields: model.fields.filter((f: Field) => !isEntityHidden(f)).map((f: Field) => f.name),
                relations
            };
        }
        const isZod = this.config.outputType === 'zod';
        // Zod mode output must stay framework-free and Prisma 8 has no `@prisma/client`, so the model-name union is inlined.
        const inlineModelName = isZod || this.config.prisma8;
        const modelNameHeader = inlineModelName
            ? `export type ModelName = ${models.map((m) => `'${m.name}'`).join(' | ') || 'never'};`
            : `import type { Prisma } from '@prisma/client';`;
        const manifestContent = `${modelNameHeader}

export interface RelationDescriptor {
    type: string;
    isList: boolean;
}

export interface ModelManifest {
    primaryKey: string;
    entityFields: string[];
    relations: Record<string, RelationDescriptor>;
}

export const PrismaManifest: Record<${inlineModelName ? 'ModelName' : 'Prisma.ModelName'}, ModelManifest> = ${JSON.stringify(map, null, 4)};
`;

        const modelNames = models.map((m) => m.name);
        const isFlat = this.config.outputStructure === 'flat';
        const entitySuffix = isZod ? '.schema' : '.entity';
        const importLines = modelNames
            .map((name) => {
                const fileName = this.getModelName(name);
                const importPath = isFlat ? `./${fileName}${entitySuffix}` : `./${fileName}/${fileName}${entitySuffix}`;
                return `import type { ${name} as ${name}Entity } from '${importPath}';`;
            })
            .join('\n');
        const mapLines = modelNames.map((name) => `    ${name}: ${name}Entity;`).join('\n');
        const entityMapContent = `${importLines}

export interface ModelEntityMap {
${mapLines}
}
`;
        return [
            { path: `${this.config.output}/manifest.ts`, content: manifestContent },
            { path: `${this.config.output}/model-entity-map.ts`, content: entityMapContent }
        ];
    }
}
