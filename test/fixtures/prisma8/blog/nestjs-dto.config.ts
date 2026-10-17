import type { GeneratorConfigFile } from '../../../../src/types';

/** Mirrors `examples/prisma8-nestjs/nestjs-dto.config.ts`; used by `test/prisma8-e2e.spec.ts`. */
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
