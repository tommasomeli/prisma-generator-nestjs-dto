import { z } from 'zod';
import { RoleSchema } from '../enums/role.enum';
import { PostSchema } from '../post/post.schema';
import { DateTimeEntitySchema } from '../scalars';

export const UserSchema = z.object({
    id: z.int(),
    email: z.string(),
    name: z.string(),
    role: RoleSchema,
    bio: z.string().nullish(),
    get posts(): z.ZodOptional<z.ZodNullable<z.ZodArray<typeof PostSchema>>> {
        return z.array(PostSchema).nullish();
    },
    createdAt: DateTimeEntitySchema,
    updatedAt: DateTimeEntitySchema
}).meta({ id: 'User' });

export type User = z.infer<typeof UserSchema>;
