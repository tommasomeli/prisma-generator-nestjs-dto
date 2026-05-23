const { BaseGenerator } = require('../../dist/index.cjs');

class LifecycleGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.lifecycle';
    classPrefix = 'Lifecycle';
    classSuffix = '';

    async beforeAll(models) {
        for (const model of models) model.annotations.push({ name: 'BeforeAllTouched', params: [] });
    }

    async generate() {
        return this.models.map((model) => {
            const touched = model.annotations.some((a) => a.name === 'BeforeAllTouched');
            return {
                path: this.getPath(model),
                content: `export const beforeAllTouched_${model.name} = ${touched};\n`
            };
        });
    }

    async afterAll(files) {
        const outputDir = this.config.output;
        return [
            {
                path: `${outputDir}/_audit.ts`,
                content: `export const emittedFiles = ${files.length};\n`
            }
        ];
    }
}

module.exports = { LifecycleGenerator };
