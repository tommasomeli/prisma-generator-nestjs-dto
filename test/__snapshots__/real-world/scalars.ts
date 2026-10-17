import { z } from 'zod';

/** ISO 8601 date-time string: the JSON representation of a Prisma `DateTime`. */
export const DateTimeSchema = z.iso.datetime({ offset: true });

/** Response-side `DateTime`: `Date` instances (e.g. Prisma results) are serialized to ISO strings first. */
export const DateTimeEntitySchema = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), DateTimeSchema);

/** Integer string: the JSON representation of a Prisma `BigInt`. */
export const BigIntSchema = z.string().regex(/^-?\d+$/);

/** Response-side `BigInt`: `bigint` values are serialized to strings first. */
export const BigIntEntitySchema = z.preprocess((value) => (typeof value === 'bigint' ? value.toString() : value), BigIntSchema);

/** Response-side `Decimal`: Decimal.js-like values (Prisma results) are converted to numbers first. */
export const DecimalEntitySchema = z.preprocess(
    (value) => (value !== null && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function' ? value.toNumber() : value),
    z.number()
);

/** Base64 string: the JSON representation of a Prisma `Bytes`. */
export const BytesSchema = z.base64();

/** Response-side `Bytes`: `Uint8Array` values are serialized to base64 first. */
export const BytesEntitySchema = z.preprocess((value) => (value instanceof Uint8Array ? z.util.uint8ArrayToBase64(value) : value), BytesSchema);
