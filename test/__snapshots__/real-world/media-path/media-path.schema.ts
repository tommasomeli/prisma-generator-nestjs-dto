import { z } from 'zod';
import { DateTimeEntitySchema } from '../scalars';
import { MediaSchema } from '../media/media.schema';

export const MediaPathSchema = z.object({
    id: z.int(),
    createdAt: DateTimeEntitySchema.nullish(),
    updatedAt: DateTimeEntitySchema.nullish(),
    deletedAt: DateTimeEntitySchema.nullish(),
    pathname: z.string().nullish(),
    get parent(): z.ZodOptional<z.ZodNullable<typeof MediaPathSchema>> {
        return MediaPathSchema.nullish();
    },
    get children(): z.ZodOptional<z.ZodNullable<z.ZodArray<typeof MediaPathSchema>>> {
        return z.array(MediaPathSchema).nullish();
    },
    get media(): z.ZodOptional<z.ZodNullable<z.ZodArray<typeof MediaSchema>>> {
        return z.array(MediaSchema).nullish();
    }
}).meta({ id: 'MediaPath' });

export type MediaPath = z.infer<typeof MediaPathSchema>;
