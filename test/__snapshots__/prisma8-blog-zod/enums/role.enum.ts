import { z } from 'zod';

export const RoleSchema = z.enum(['ADMIN', 'USER']).meta({ id: 'Role' });

export const Role = RoleSchema.enum;

export type Role = z.infer<typeof RoleSchema>;
