import { z } from 'zod';
import { DateTimeSchema } from '../scalars';
import { MediaFormatsSchema } from '../../../fixtures/real-world/shared/media-formats';

export const CreateMediaSchema = z.object({
    deletedAt: DateTimeSchema.nullish(),
    name: z.string().max(255).min(1),
    filename: z.string().max(255).min(1),
    ext: z.string().max(255).min(1),
    base64: z.string().nullish(),
    hidden: z.boolean().nullable().default(false),
    path: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    parent: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    children: z.array(z.union([z.int(), z.looseObject({ id: z.int().optional() })])).nullish(),
    formats: MediaFormatsSchema.readonly().nullish(),
    mimeType: z.string().readonly().nullish()
}).meta({ id: 'CreateMedia' });

/** Payload / form values accepted by `CreateMediaSchema` (fields with defaults stay optional). */
export type CreateMedia = z.input<typeof CreateMediaSchema>;

/** Result of parsing with `CreateMediaSchema` (defaults applied). */
export type CreateMediaOutput = z.output<typeof CreateMediaSchema>;
