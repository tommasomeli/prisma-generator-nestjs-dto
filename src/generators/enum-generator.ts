import { BaseGenerator } from '../base-generator';
import { File } from '../types';

/** DMMF enum, reduced to what the enum files need. */
type EnumDefinition = { name: string; documentation?: string; values: readonly { name: string; dbName?: string | null }[] };

const NUMERIC_VALUE = /^-?\d+(?:\.\d+)?$/;

/**
 * Prisma 8 mode only (class / interface output): there is no `@prisma/client` to import enums
 * from, so every enum is emitted as a local TypeScript `enum` at `<output>/enums/<name>.enum.ts`
 * (`<output>/<name>.enum.ts` with the `flat` structure), the layout of the Zod mode.
 *
 * Member values are the stored values Prisma 8 returns at runtime: the `dbName` (the contract
 * member `value`) when it differs from the name, the name otherwise. When every stored value is
 * numeric the enum is numeric (`Low = 0`). Emits nothing outside Prisma 8 mode.
 */
export default class EnumGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.enum';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        if (!this.config.prisma8 || this.config.outputType === 'zod') return [];
        const enums = (this.options.dmmf.datamodel.enums ?? []) as readonly EnumDefinition[];
        return enums.map((e) => ({ path: this.getEnumPath(e.name), content: this.renderEnum(e) }));
    }

    /** Renders `export enum Name { A = 'A', ... }`. */
    private renderEnum(definition: EnumDefinition): string {
        const stored = definition.values.map((v) => v.dbName ?? v.name);
        const numeric = stored.length > 0 && stored.every((value) => NUMERIC_VALUE.test(value));
        const members = definition.values.map((v, i) => `    ${v.name} = ${numeric ? stored[i] : `'${stored[i].replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`}`).join(',\n');
        const doc = definition.documentation ? `/** ${definition.documentation.replace(/\*\//g, '*\\/').split('\n').join('\n * ')} */\n` : '';
        return `${doc}export enum ${definition.name} {\n${members}\n}\n`;
    }
}
