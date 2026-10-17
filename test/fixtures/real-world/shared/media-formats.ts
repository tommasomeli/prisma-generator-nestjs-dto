import { z } from 'zod';

export const MediaFormatSchema = z.object({
    url: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    size: z.number()
});

export const MediaFormatsSchema = z
    .object({
        original: MediaFormatSchema,
        webp: MediaFormatSchema.optional(),
        large: MediaFormatSchema.optional(),
        medium: MediaFormatSchema.optional(),
        thumbnail: MediaFormatSchema.optional()
    })
    .meta({ id: 'MediaFormats' });
