import type { GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';

/**
 * Prisma 8 has no `generator` block: every option lives here and the CLI is
 * invoked explicitly (see `scripts.generate`). Same file format as Prisma 5-7.
 */
export default {
    outputType: 'class',
    outputStructure: 'nestjs',
    fileNamingStrategy: 'kebab',
    reExport: true,
    classValidator: true,
    swaggerDocs: true,
    prettier: false,
    emitManifest: true,
    extraAnnotations: ['Auditable']
} satisfies GeneratorConfigFile;
