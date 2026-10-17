import { z } from 'zod';
import { DateTimeEntitySchema } from '../scalars';
import { MediaPathSchema } from '../media-path/media-path.schema';
import { MediaFormatsSchema } from '../../../fixtures/real-world/shared/media-formats';

export const MediaSchema = z.object({
    id: z.int(),
    createdAt: DateTimeEntitySchema.nullish(),
    updatedAt: DateTimeEntitySchema.nullish(),
    deletedAt: DateTimeEntitySchema.nullish(),
    name: z.string(),
    filename: z.string(),
    ext: z.string(),
    base64: z.string().nullish(),
    hidden: z.boolean().nullish(),
    get path(): z.ZodOptional<z.ZodNullable<typeof MediaPathSchema>> {
        return MediaPathSchema.nullish();
    },
    get parent(): z.ZodOptional<z.ZodNullable<typeof MediaSchema>> {
        return MediaSchema.nullish();
    },
    get children(): z.ZodOptional<z.ZodNullable<z.ZodArray<typeof MediaSchema>>> {
        return z.array(MediaSchema).nullish();
    },
    formats: MediaFormatsSchema.readonly().nullish(),
    mimeType: z.string().readonly().nullish()
}).meta({ id: 'Media' });

export type Media = z.infer<typeof MediaSchema>;
