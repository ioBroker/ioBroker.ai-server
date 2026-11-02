import { expect } from 'chai';
import { formatSize, modelOptions, normalizeModelName, RECOMMENDED_MODELS, sameModel, toModelInfos } from './models';
import { isValidModelName } from './ollama-client';

describe('models', () => {
    describe('normalizeModelName', () => {
        it('adds the tag latest to a name without tag', () => {
            expect(normalizeModelName('qwen3')).to.equal('qwen3:latest');
            expect(normalizeModelName('qwen3:4b')).to.equal('qwen3:4b');
        });

        it('removes the default registry and namespace', () => {
            expect(normalizeModelName('library/qwen3:4b')).to.equal('qwen3:4b');
            expect(normalizeModelName('registry.ollama.ai/library/qwen3')).to.equal('qwen3:latest');
        });

        it('ignores case and spaces around the name', () => {
            expect(normalizeModelName(' Qwen3:4B ')).to.equal('qwen3:4b');
        });

        it('keeps other registries and does not take a port for a tag', () => {
            expect(normalizeModelName('hf.co/user/repo:Q4_K_M')).to.equal('hf.co/user/repo:q4_k_m');
            expect(normalizeModelName('myhost:5000/team/model')).to.equal('myhost:5000/team/model:latest');
        });
    });

    describe('sameModel', () => {
        it('compares the normalized names', () => {
            expect(sameModel('llama3.2', 'llama3.2:latest')).to.equal(true);
            expect(sameModel('library/qwen3:4b', 'qwen3:4b')).to.equal(true);
            expect(sameModel('qwen3:4b', 'qwen3:8b')).to.equal(false);
        });
    });

    describe('toModelInfos', () => {
        it('combines the downloaded and the loaded models', () => {
            const infos = toModelInfos(
                [
                    {
                        name: 'qwen3:4b',
                        model: 'qwen3:4b',
                        size: 2_497_293_931,
                        details: { parameter_size: '4.0B', quantization_level: 'Q4_K_M' },
                    },
                    { name: 'llama3.2:latest', model: 'llama3.2:latest', size: 2_019_393_189 },
                ],
                [{ name: 'llama3.2', model: 'llama3.2', size: 3_000_000_000 }],
            );
            expect(infos).to.deep.equal([
                { name: 'qwen3:4b', size: 2_497_293_931, parameterSize: '4.0B', quantization: 'Q4_K_M', loaded: false },
                { name: 'llama3.2:latest', size: 2_019_393_189, parameterSize: '', quantization: '', loaded: true },
            ]);
        });
    });

    describe('formatSize', () => {
        it('uses decimal units like Ollama', () => {
            expect(formatSize(2_497_293_931)).to.equal('2.5 GB');
            expect(formatSize(13_793_441_566)).to.equal('13.8 GB');
            expect(formatSize(815_000_000)).to.equal('815 MB');
        });
    });

    describe('RECOMMENDED_MODELS', () => {
        it('contains valid names, sorted by size', () => {
            for (const model of RECOMMENDED_MODELS) {
                expect(isValidModelName(model.name), model.name).to.equal(true);
            }
            const sizes = RECOMMENDED_MODELS.map(model => model.size);
            expect(sizes).to.deep.equal([...sizes].sort((a, b) => a - b));
        });
    });

    describe('modelOptions', () => {
        it('offers the recommended models if none is downloaded', () => {
            const options = modelOptions([]);
            expect(options.map(option => option.value)).to.deep.equal(RECOMMENDED_MODELS.map(model => model.name));
            expect(options[0]).to.deep.equal({
                value: 'qwen3:1.7b',
                label: 'qwen3:1.7b (1.4 GB)',
                noTranslation: true,
            });
        });

        it('shows the downloaded models first, marked, and does not repeat them', () => {
            const options = modelOptions([
                { name: 'qwen3:4b', size: 2_497_293_931 },
                { name: 'mistral:latest', size: 4_372_824_384 },
            ]);
            expect(options.slice(0, 2)).to.deep.equal([
                { value: 'mistral:latest', label: '✓ mistral:latest (4.4 GB)', noTranslation: true },
                { value: 'qwen3:4b', label: '✓ qwen3:4b (2.5 GB)', noTranslation: true },
            ]);
            expect(options.filter(option => option.value === 'qwen3:4b')).to.have.length(1);
            expect(options).to.have.length(RECOMMENDED_MODELS.length + 1);
        });
    });
});
