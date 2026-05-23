import { BaseGenerator, type File, type Model } from '../../src';

export class TsPluginGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.ts-plugin';
    classPrefix = 'TsPlugin';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models.map((model: Model) => ({
            path: this.getPath(model),
            content: `export const TsPlugin_${model.name} = '${model.name}';\n`
        }));
    }
}
