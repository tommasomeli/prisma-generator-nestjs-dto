import { selectCreateFields, selectUpdateFields } from '../../field-selection';
import { File } from '../../types';
import { Utility } from '../../utility';
import { ZodBaseGenerator, ZodSchemaKind, pascalCase } from './zod-base-generator';

/** Server-only rule as serialized into `server-rules.ts`. */
export type ServerRule = {
    model: string;
    field: string;
    rule: string;
    args: string[];
    message?: string;
    schemas: ('create' | 'update')[];
};

const WIRE_SCALARS = `import { z } from 'zod';

/** ISO 8601 date-time string: the JSON representation of a Prisma \`DateTime\`. */
export const DateTimeSchema = z.iso.datetime({ offset: true });

/** Response-side \`DateTime\`: \`Date\` instances (e.g. Prisma results) are serialized to ISO strings first. */
export const DateTimeEntitySchema = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), DateTimeSchema);

/** Integer string: the JSON representation of a Prisma \`BigInt\`. */
export const BigIntSchema = z.string().regex(/^-?\\d+$/);

/** Response-side \`BigInt\`: \`bigint\` values are serialized to strings first. */
export const BigIntEntitySchema = z.preprocess((value) => (typeof value === 'bigint' ? value.toString() : value), BigIntSchema);

/** Response-side \`Decimal\`: Decimal.js-like values (Prisma results) are converted to numbers first. */
export const DecimalEntitySchema = z.preprocess(
    (value) => (value !== null && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function' ? value.toNumber() : value),
    z.number()
);

/** Base64 string: the JSON representation of a Prisma \`Bytes\`. */
export const BytesSchema = z.base64();

/** Response-side \`Bytes\`: \`Uint8Array\` values are serialized to base64 first. */
export const BytesEntitySchema = z.preprocess((value) => (value instanceof Uint8Array ? z.util.uint8ArrayToBase64(value) : value), BytesSchema);
`;

const CODEC_SCALARS = `import { z } from 'zod';

/** ISO 8601 date-time string on the wire, \`Date\` once decoded. */
export const DateTimeSchema = z.codec(z.iso.datetime({ offset: true }), z.date(), {
    decode: (value) => new Date(value),
    encode: (value) => value.toISOString()
});

export const DateTimeEntitySchema = DateTimeSchema;

/** Integer string on the wire, \`bigint\` once decoded. */
export const BigIntSchema = z.codec(z.string().regex(/^-?\\d+$/), z.bigint(), {
    decode: (value) => BigInt(value),
    encode: (value) => value.toString()
});

export const BigIntEntitySchema = BigIntSchema;

/** Prisma \`Decimal\` as a JSON number (convert Decimal.js values before encoding). */
export const DecimalEntitySchema = z.number();

/** Base64 string on the wire, \`Uint8Array\` once decoded. */
export const BytesSchema = z.codec(z.base64(), z.instanceof(Uint8Array), {
    decode: (value) => z.util.base64ToUint8Array(value),
    encode: (value) => z.util.uint8ArrayToBase64(value)
});

export const BytesEntitySchema = BytesSchema;
`;

/**
 * Emits the model-independent files of the Zod mode: one schema per Prisma enum,
 * the shared scalar helpers (`scalars.ts`) and the server-only validation rules
 * (`server-rules.ts`). Logs a single warning when server-only rules were found.
 */
export class ZodSupportGenerator extends ZodBaseGenerator {
    readonly schemaKind: ZodSchemaKind = 'entity';
    filePrefix = '';
    fileSuffix = '';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        const enumFiles = this.getEnums().map((e) => {
            const name = `${pascalCase(e.name)}Schema`;
            const typeName = pascalCase(e.name);
            const meta = this.config.zodMeta ? `.meta({ id: '${typeName}' })` : '';
            const values = e.entries
                ? `{ ${e.entries.map(([member, value]) => `${member}: ${typeof value === 'number' ? value : `'${value.replace(/'/g, "\\'")}'`}`).join(', ')} }`
                : `[${e.values.map((v) => `'${v}'`).join(', ')}]`;
            return {
                path: this.enumSchemaPath(e.name),
                content: `import { z } from 'zod';\n\nexport const ${name} = z.enum(${values})${meta};\n\nexport const ${typeName} = ${name}.enum;\n\nexport type ${typeName} = z.infer<typeof ${name}>;\n`
            };
        });
        const rules = this.getServerRules();
        if (rules.length) {
            const names = [...new Set(rules.map((r) => r.rule))].join(', ');
            Utility.warn(`Zod mode: ${rules.length} server-only validation rule(s) (${names}) cannot be expressed in Zod and were exported to ${this.serverRulesPath()}; enforce them in the API.`);
        }
        return [
            ...enumFiles,
            { path: this.scalarsPath(), content: this.config.zodCodecs ? CODEC_SCALARS : WIRE_SCALARS },
            { path: this.serverRulesPath(), content: this.renderServerRules(rules) }
        ];
    }

    /**
     * Collects every untranslatable validator of the fields present in Create / Update schemas.
     *
     * @return Deduplicated server rules.
     */
    public getServerRules(): ServerRule[] {
        const rules = new Map<string, ServerRule>();
        for (const model of this.models) {
            const scopes: ['create' | 'update', ReturnType<typeof selectCreateFields>][] = [
                ['create', selectCreateFields(model)],
                ['update', selectUpdateFields(model)]
            ];
            for (const [scope, fields] of scopes) {
                for (const field of fields) {
                    for (const draft of this.collectServerRules(field)) {
                        const key = JSON.stringify([model.name, field.name, draft.rule, draft.args]);
                        const existing = rules.get(key);
                        if (existing) {
                            if (!existing.schemas.includes(scope)) existing.schemas.push(scope);
                            continue;
                        }
                        rules.set(key, { model: model.name, field: field.name, rule: draft.rule, args: draft.args, ...(draft.message ? { message: draft.message } : {}), schemas: [scope] });
                    }
                }
            }
        }
        return [...rules.values()];
    }

    /** Renders `server-rules.ts`. */
    private renderServerRules(rules: ServerRule[]): string {
        return `/** Validation rule that cannot be expressed in Zod and must be enforced by the API. */
export interface ServerRule {
    model: string;
    field: string;
    /** Validator name as written in the Prisma schema (e.g. \`IsUnique\`). */
    rule: string;
    /** Raw argument sources, as written in the Prisma schema. */
    args: readonly string[];
    /** Resolved error message (literal or translation key), when declared. */
    message?: string;
    /** Schemas in which the field is present. */
    schemas: readonly ('create' | 'update')[];
}

export const serverRules: readonly ServerRule[] = ${JSON.stringify(rules, null, 4)};
`;
    }
}
