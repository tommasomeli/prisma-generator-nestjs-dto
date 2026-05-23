import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import { buildOptions } from './helpers/build-options';

describe('BaseGenerator lifecycle hooks', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-lc-'));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('runs beforeAll on the shared models before any generate() call', async () => {
        const fixture = path.resolve(__dirname, 'fixtures/lifecycle-generator.cjs');
        const options = buildOptions({
            output: outDir,
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false',
                extraGenerators: `LifecycleGenerator:${fixture}`
            }
        });
        await generate(options);
        const emitted = fs.readFileSync(path.join(outDir, 'widget.lifecycle.ts'), 'utf8');
        expect(emitted).toContain('beforeAllTouched_Widget = true');
    });

    it('appends files returned from afterAll to the emitted set', async () => {
        const fixture = path.resolve(__dirname, 'fixtures/lifecycle-generator.cjs');
        const options = buildOptions({
            output: outDir,
            models: [
                { name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] },
                { name: 'Gadget', fields: [{ name: 'id', type: 'Int', isId: true }] }
            ],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false',
                extraGenerators: `LifecycleGenerator:${fixture}`
            }
        });
        await generate(options);
        const auditPath = path.join(outDir, '_audit.ts');
        expect(fs.existsSync(auditPath)).toBe(true);
        const audit = fs.readFileSync(auditPath, 'utf8');
        // built-ins (3 per model) + lifecycle (1 per model) = 8 for 2 models
        expect(audit).toMatch(/emittedFiles = 8/);
    });

    it('default hooks on BaseGenerator are no-ops (built-ins keep working unchanged)', async () => {
        const options = buildOptions({
            output: outDir,
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false'
            }
        });
        await generate(options);
        expect(fs.existsSync(path.join(outDir, 'widget.entity.ts'))).toBe(true);
    });
});
