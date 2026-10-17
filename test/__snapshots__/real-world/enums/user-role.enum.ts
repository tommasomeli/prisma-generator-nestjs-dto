import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'manager', 'guest']).meta({ id: 'UserRole' });

export const UserRole = UserRoleSchema.enum;

export type UserRole = z.infer<typeof UserRoleSchema>;
