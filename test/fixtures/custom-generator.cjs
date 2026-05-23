const { BaseGenerator } = require('../../dist/index.cjs');

class MyTestGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.custom';
    classPrefix = 'Custom';
    classSuffix = '';

    async generate() {
        return this.models.map((model) => ({
            path: this.getPath(model),
            content: `export const ${this.classPrefix}${model.name} = '${model.name}';\n`
        }));
    }
}

module.exports = { MyTestGenerator };
