import { z } from 'zod';
import { DateTimeEntitySchema } from '../scalars';
import { UserRoleSchema } from '../enums/user-role.enum';
import { UserProviderSchema } from '../enums/user-provider.enum';
import { MediaSchema } from '../media/media.schema';
import { LanguageSchema } from '../language/language.schema';
import { MfaMethodSchema } from '../enums/mfa-method.enum';

export const UserSchema = z.object({
    id: z.int(),
    createdAt: DateTimeEntitySchema.nullish(),
    updatedAt: DateTimeEntitySchema.nullish(),
    deletedAt: DateTimeEntitySchema.nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    userName: z.string().nullish(),
    email: z.string().nullish(),
    gCalendarUrl: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    role: UserRoleSchema.nullish(),
    password: z.string().nullish(),
    isActive: z.boolean().nullish(),
    activatable: z.boolean().nullish(),
    provider: UserProviderSchema.nullish(),
    get avatar(): z.ZodOptional<z.ZodNullable<typeof MediaSchema>> {
        return MediaSchema.nullish();
    },
    get language(): z.ZodOptional<z.ZodNullable<typeof LanguageSchema>> {
        return LanguageSchema.nullish();
    },
    mfaEnabled: z.boolean(),
    mfaMethod: MfaMethodSchema.nullish()
}).meta({ id: 'User' });

export type User = z.infer<typeof UserSchema>;
