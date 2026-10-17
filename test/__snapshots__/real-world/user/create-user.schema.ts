import { z } from 'zod';
import { DateTimeSchema } from '../scalars';
import { UserRoleSchema } from '../enums/user-role.enum';
import { UserProviderSchema } from '../enums/user-provider.enum';
import { MfaMethodSchema } from '../enums/mfa-method.enum';
import * as CONSTANTS from '../../../fixtures/real-world/shared/constants';

export const CreateUserSchema = z.object({
    deletedAt: DateTimeSchema.nullish(),
    firstName: z.string().max(255).nullish(),
    lastName: z.string().max(255).nullish(),
    userName: z.string().max(255).nullish(),
    email: z.string().max(255).nullish(),
    gCalendarUrl: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    role: UserRoleSchema.nullable().default('guest'),
    password: z.string().min(6, { error: 'validation.fields.password' }).max(20, { error: 'validation.fields.password' }).regex(CONSTANTS.PASS_REGEX, { error: 'validation.fields.password' }).nullish(),
    isActive: z.boolean().nullable().default(false),
    activatable: z.boolean().nullable().default(false),
    provider: UserProviderSchema.nullable().default('local'),
    avatar: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    language: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    mfaEnabled: z.boolean().default(false),
    mfaMethod: MfaMethodSchema.nullish()
}).meta({ id: 'CreateUser' });

/** Payload / form values accepted by `CreateUserSchema` (fields with defaults stay optional). */
export type CreateUser = z.input<typeof CreateUserSchema>;

/** Result of parsing with `CreateUserSchema` (defaults applied). */
export type CreateUserOutput = z.output<typeof CreateUserSchema>;
