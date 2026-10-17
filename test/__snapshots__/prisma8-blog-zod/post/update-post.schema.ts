import { z } from 'zod';
import { DateTimeSchema } from '../scalars';

export const UpdatePostSchema = z.object({
    id: z.int(),
    title: z.string().max(120).min(1).optional(),
    body: z.string().min(1).optional(),
    score: z.string().optional(),
    meta: z.json().nullish(),
    author: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).optional(),
    createdAt: DateTimeSchema.optional()
}).meta({ id: 'UpdatePost' });

/** Payload / form values accepted by `UpdatePostSchema` (fields with defaults stay optional). */
export type UpdatePost = z.input<typeof UpdatePostSchema>;

/** Result of parsing with `UpdatePostSchema` (defaults applied). */
export type UpdatePostOutput = z.output<typeof UpdatePostSchema>;
