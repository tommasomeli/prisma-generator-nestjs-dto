import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Recursively lists the `.ts` files under `dir`. */
export function listTsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listTsFiles(full);
        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

/** Type-checks `files` with strict settings and returns formatted diagnostics (empty when clean). */
export function typecheck(files: string[]): string[] {
    const program = ts.createProgram(files, {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        types: ['node']
    });
    return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n') + (d.file ? ` (${path.basename(d.file.fileName)})` : ''));
}
