import { expect } from 'chai';
import { DAY_MS, daysSince, findUnusedModels, type ModelUsage } from './usage';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

describe('usage', () => {
    describe('daysSince', () => {
        it('counts whole days', () => {
            expect(daysSince(NOW, NOW)).to.equal(0);
            expect(daysSince(NOW - DAY_MS + 1, NOW)).to.equal(0);
            expect(daysSince(NOW - DAY_MS, NOW)).to.equal(1);
            expect(daysSince(NOW - 12.5 * DAY_MS, NOW)).to.equal(12);
        });

        it('does not count a use in the future as negative', () => {
            expect(daysSince(NOW + DAY_MS, NOW)).to.equal(0);
        });
    });

    describe('findUnusedModels', () => {
        const models: ModelUsage[] = [
            { name: 'old:1b', loaded: false, lastUsed: NOW - 40 * DAY_MS },
            { name: 'recent:1b', loaded: false, lastUsed: NOW - 2 * DAY_MS },
            { name: 'loaded:1b', loaded: true, lastUsed: NOW - 40 * DAY_MS },
            { name: 'unknown:1b', loaded: false, lastUsed: undefined },
            { name: 'qwen3:latest', loaded: false, lastUsed: NOW - 40 * DAY_MS },
        ];

        it('deletes nothing if the option is off', () => {
            expect(findUnusedModels(models, NOW, 0, [])).to.deep.equal([]);
            expect(findUnusedModels(models, NOW, Number.NaN, [])).to.deep.equal([]);
        });

        it('finds the models not used for the given days', () => {
            expect(findUnusedModels(models, NOW, 30, [])).to.deep.equal(['old:1b', 'qwen3:latest']);
            expect(findUnusedModels(models, NOW, 2, [])).to.deep.equal(['old:1b', 'recent:1b', 'qwen3:latest']);
        });

        it('keeps loaded models, models without known use and the given ones', () => {
            // "qwen3" is the same model as "qwen3:latest"
            expect(findUnusedModels(models, NOW, 30, ['qwen3', ''])).to.deep.equal(['old:1b']);
        });
    });
});
