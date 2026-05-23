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
 * Opt-in via the `emitManifest` config option (defaults to `false`).
 */
export default class ManifestGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        const map: Record<string, { primaryKey: string; entityFields: string[]; relations: Record<string, { type: string; isList: boolean }> }> = {};
        for (const model of this.models) {
            const relations: Record<string, { type: string; isList: boolean }> = {};
            for (const f of model.fields as Field[]) {
                if (f.kind !== 'object') continue;
                relations[f.name] = { type: f.type, isList: Boolean(f.isList) };
            }
            map[model.name] = {
                primaryKey: model.fields.find((f: Field) => f.isId)?.name || 'id',
                entityFields: model.fields.filter((f: Field) => !isEntityHidden(f)).map((f: Field) => f.name),
                relations
            };
        }
        const manifestContent = `import type { Prisma } from '@prisma/client';

export interface RelationDescriptor {
    type: string;
    isList: boolean;
}

export interface ModelManifest {
    primaryKey: string;
    entityFields: string[];
    relations: Record<string, RelationDescriptor>;
}

export const PrismaManifest: Record<Prisma.ModelName, ModelManifest> = ${JSON.stringify(map, null, 4)};
`;

        const modelNames = this.models.map((m) => m.name);
        const isFlat = this.config.outputStructure === 'flat';
        const importLines = modelNames
            .map((name) => {
                const fileName = this.getModelName(name);
                const importPath = isFlat ? `./${fileName}.entity` : `./${fileName}/${fileName}.entity`;
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
