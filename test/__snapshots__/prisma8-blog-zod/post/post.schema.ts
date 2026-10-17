import { z } from 'zod';
import { UserSchema } from '../user/user.schema';
import { DateTimeEntitySchema } from '../scalars';

export const PostSchema = z.object({
    id: z.int(),
    title: z.string(),
    body: z.string(),
    score: z.string(),
    meta: z.json().nullish(),
    get author(): typeof UserSchema {
        return UserSchema;
    },
    authorId: z.int(),
    createdAt: DateTimeEntitySchema
}).meta({ id: 'Post' });

export type Post = z.infer<typeof PostSchema>;
