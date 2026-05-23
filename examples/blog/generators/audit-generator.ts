import { BaseGenerator, type File, type Model } from '@tommasomeli/prisma-generator-nestjs-dto';

/**
 * Custom sub-generator that emits a minimal `*.audit.ts` file per model annotated with
 * `/// @Auditable("table_name")` in the Prisma schema. Demonstrates:
 *   - custom annotations (`@Auditable`) read via `getAnnotation`
 *   - `addImport` / `formatImports` / `getImportPath` for clean peer-file references
 *   - the optional `afterAll` lifecycle hook to emit an aggregated index of audited tables
 */
export class AuditGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.audit';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models
            .filter((m) => this.hasAnnotation(m, 'Auditable'))
            .map((m) => this.renderAudit(m));
    }

    async afterAll(files: File[]): Promise<File[]> {
        const audits = files.filter((f) => f.path.endsWith('.audit.ts'));
        if (audits.length === 0) return [];
        const lines = audits.map((f) => `export * from './${this.toExportPath(f.path)}';`).join('\n');
        return [{ path: `${this.config.output}/audit-index.ts`, content: `${lines}\n` }];
    }

    private renderAudit(model: Model): File {
        const raw = String(this.getAnnotation(model, 'Auditable')?.params?.[0] ?? `${model.name}_audit`);
        // Strip surrounding quotes left by the annotation parser (it keeps them verbatim).
        const tableName = raw.replace(/^["']|["']$/g, '');
        return {
            path: this.getPath(model),
            content: `export const ${model.name}AuditTable = '${tableName}';\n`
        };
    }

    private toExportPath(absolutePath: string): string {
        const relative = absolutePath.replace(/\.ts$/, '');
        const idx = relative.lastIndexOf(this.config.output);
        return idx >= 0 ? relative.slice(idx + this.config.output.length + 1) : relative;
    }
}
