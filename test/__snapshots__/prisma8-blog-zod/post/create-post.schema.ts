import { z } from 'zod';
import { DateTimeSchema } from '../scalars';

export const CreatePostSchema = z.object({
    title: z.string().max(120).min(1),
    body: z.string().min(1),
    score: z.string(),
    meta: z.json().nullish(),
    author: z.union([z.int(), z.looseObject({ id: z.int().optional() })]),
    createdAt: DateTimeSchema.optional()
}).meta({ id: 'CreatePost' });

/** Payload / form values accepted by `CreatePostSchema` (fields with defaults stay optional). */
export type CreatePost = z.input<typeof CreatePostSchema>;

/** Result of parsing with `CreatePostSchema` (defaults applied). */
export type CreatePostOutput = z.output<typeof CreatePostSchema>;
