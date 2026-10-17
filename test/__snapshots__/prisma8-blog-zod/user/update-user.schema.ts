import { z } from 'zod';
import { RoleSchema } from '../enums/role.enum';
import { DateTimeSchema } from '../scalars';

export const UpdateUserSchema = z.object({
    id: z.int(),
    email: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    role: RoleSchema.optional(),
    bio: z.string().max(255).nullish(),
    posts: z.array(z.union([z.int(), z.looseObject({ id: z.int().optional() })])).nullish(),
    createdAt: DateTimeSchema.optional()
}).meta({ id: 'UpdateUser' });

/** Payload / form values accepted by `UpdateUserSchema` (fields with defaults stay optional). */
export type UpdateUser = z.input<typeof UpdateUserSchema>;

/** Result of parsing with `UpdateUserSchema` (defaults applied). */
export type UpdateUserOutput = z.output<typeof UpdateUserSchema>;
