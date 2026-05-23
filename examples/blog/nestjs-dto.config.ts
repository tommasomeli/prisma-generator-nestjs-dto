import { from, type GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';

export default {
    extraAnnotations: ['Auditable'],
    extraGenerators: from('./generators/audit-generator.ts', ['AuditGenerator'])
} satisfies GeneratorConfigFile;
