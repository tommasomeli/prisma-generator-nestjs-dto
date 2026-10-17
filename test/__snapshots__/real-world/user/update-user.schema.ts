import { z } from 'zod';
import { DateTimeSchema } from '../scalars';
import { UserRoleSchema } from '../enums/user-role.enum';
import { UserProviderSchema } from '../enums/user-provider.enum';
import { MfaMethodSchema } from '../enums/mfa-method.enum';
import * as CONSTANTS from '../../../fixtures/real-world/shared/constants';

export const UpdateUserSchema = z.object({
    id: z.int(),
    deletedAt: DateTimeSchema.nullish(),
    firstName: z.string().max(255).nullish(),
    lastName: z.string().max(255).nullish(),
    userName: z.string().max(255).nullish(),
    email: z.string().max(255).nullish(),
    gCalendarUrl: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    role: UserRoleSchema.nullish(),
    password: z.string().min(6, { error: 'validation.fields.password' }).max(20, { error: 'validation.fields.password' }).regex(CONSTANTS.PASS_REGEX, { error: 'validation.fields.password' }).nullish(),
    isActive: z.boolean().nullish(),
    activatable: z.boolean().nullish(),
    provider: UserProviderSchema.nullish(),
    avatar: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    language: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    mfaEnabled: z.boolean().optional(),
    mfaMethod: MfaMethodSchema.nullish()
}).meta({ id: 'UpdateUser' });

/** Payload / form values accepted by `UpdateUserSchema` (fields with defaults stay optional). */
export type UpdateUser = z.input<typeof UpdateUserSchema>;

/** Result of parsing with `UpdateUserSchema` (defaults applied). */
export type UpdateUserOutput = z.output<typeof UpdateUserSchema>;
