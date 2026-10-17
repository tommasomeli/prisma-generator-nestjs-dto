import { z } from 'zod';
import { RoleSchema } from '../enums/role.enum';
import { DateTimeSchema } from '../scalars';

export const CreateUserSchema = z.object({
    email: z.string().min(1),
    name: z.string().min(1),
    role: RoleSchema.default('USER'),
    bio: z.string().max(255).nullish(),
    posts: z.array(z.union([z.int(), z.looseObject({ id: z.int().optional() })])).nullish(),
    createdAt: DateTimeSchema.optional()
}).meta({ id: 'CreateUser' });

/** Payload / form values accepted by `CreateUserSchema` (fields with defaults stay optional). */
export type CreateUser = z.input<typeof CreateUserSchema>;

/** Result of parsing with `CreateUserSchema` (defaults applied). */
export type CreateUserOutput = z.output<typeof CreateUserSchema>;
