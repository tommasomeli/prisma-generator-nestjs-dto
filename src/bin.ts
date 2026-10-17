/**
 * Binary entry point and mode dispatcher.
 *
 * - With CLI arguments (`prisma-generator-nestjs-dto --contract ...`) it runs the Prisma ORM 8 CLI.
 * - Without arguments it is a Prisma 5–7 generator: `prisma generate` spawns it and speaks JSON-RPC
 *   over stdio, handled by `@prisma/generator-helper` exactly as before.
 *
 * Both branches are loaded lazily so Prisma 8 users do not need `@prisma/generator-helper` installed.
 */
async function main(): Promise<void> {
    if (process.argv.length > 2) {
        const { runCli } = await import('./prisma8/cli');
        process.exit(await runCli(process.argv.slice(2)));
    }

    // `require` (not `import()`): the bundled CJS bin would otherwise get the CJS module's namespace
    // without its named exports. Resolved only on this branch, so Prisma 8 users never need it.
    const { generatorHandler } = require('@prisma/generator-helper') as typeof import('@prisma/generator-helper');
    const { generate } = await import('./generator');
    generatorHandler({
        onManifest: () => ({
            defaultOutput: '../src/generated/nestjs-dto',
            prettyName: 'NestJS DTO Generator'
        }),
        onGenerate: generate
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
