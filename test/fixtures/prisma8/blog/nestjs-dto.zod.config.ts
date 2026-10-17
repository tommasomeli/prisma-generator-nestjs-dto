import type { GeneratorConfigFile } from '../../../../src/types';

/** Zod variant of `nestjs-dto.config.ts`; used by `test/prisma8-e2e.spec.ts`. */
export default {
    outputType: 'zod',
    outputStructure: 'nestjs',
    fileNamingStrategy: 'kebab',
    reExport: true,
    prettier: false,
    emitManifest: true
} satisfies GeneratorConfigFile;
