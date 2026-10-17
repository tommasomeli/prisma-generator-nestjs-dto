/** Validation rule that cannot be expressed in Zod and must be enforced by the API. */
export interface ServerRule {
    model: string;
    field: string;
    /** Validator name as written in the Prisma schema (e.g. `IsUnique`). */
    rule: string;
    /** Raw argument sources, as written in the Prisma schema. */
    args: readonly string[];
    /** Resolved error message (literal or translation key), when declared. */
    message?: string;
    /** Schemas in which the field is present. */
    schemas: readonly ('create' | 'update')[];
}

export const serverRules: readonly ServerRule[] = [];
