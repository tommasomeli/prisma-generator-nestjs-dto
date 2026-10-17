/**
 * Shorthand ambient modules for the decorator packages that class / interface output imports.
 * They are not dependencies of this repository, so type-checks of generated DTOs (see `typecheck.ts`)
 * add this file to resolve them as `any`; every other module (relative imports, `@prisma/orm-framework`)
 * still resolves for real.
 */
declare module '@nestjs/swagger';
declare module 'class-validator';
declare module 'class-transformer';
