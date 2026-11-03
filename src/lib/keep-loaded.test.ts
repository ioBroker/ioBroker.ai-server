import { expect } from 'chai';
import { KEEP_FOREVER, keepAliveFor, keepLoadedAction } from './keep-loaded';
import type { OllamaRunningModel } from './ollama-client';

const NOW = Date.parse('2026-11-03T16:00:00Z');

function running(name: string, expiresAt?: string): OllamaRunningModel {
    return { name, model: name, size: 1e9, expires_at: expiresAt };
}

describe('keep-loaded', () => {
    describe('keepLoadedAction', () => {
        it('loads the model if no model is loaded', () => {
            expect(keepLoadedAction('qwen3:1.7b', [], NOW)).to.equal('load');
        });

        it('does not push another model out of memory', () => {
            expect(keepLoadedAction('qwen3:1.7b', [running('llama3.2:3b', '2026-11-03T16:05:00Z')], NOW)).to.equal(
                'none',
            );
        });

        it('pins the model if Ollama will unload it', () => {
            // e.g. after a request of another client with the default keep-alive of Ollama
            expect(keepLoadedAction('qwen3:1.7b', [running('qwen3:1.7b', '2026-11-03T16:05:00Z')], NOW)).to.equal(
                'pin',
            );
        });

        it('does nothing if the model is loaded for good', () => {
            // as Ollama reports a model loaded with keep_alive -1
            expect(
                keepLoadedAction('qwen3:1.7b', [running('qwen3:1.7b', '2319-02-13T16:22:37.553977586Z')], NOW),
            ).to.equal('none');
        });

        it('does nothing if Ollama does not tell when the model is unloaded', () => {
            expect(keepLoadedAction('qwen3:1.7b', [running('qwen3:1.7b')], NOW)).to.equal('none');
            expect(keepLoadedAction('qwen3:1.7b', [running('qwen3:1.7b', 'never')], NOW)).to.equal('none');
        });

        it('compares the normalized names', () => {
            expect(keepLoadedAction('llama3.2', [running('llama3.2:latest', '2319-02-13T16:22:37Z')], NOW)).to.equal(
                'none',
            );
        });
    });

    describe('keepAliveFor', () => {
        it('keeps the kept model loaded for good', () => {
            expect(keepAliveFor('qwen3:1.7b', '5m', 'qwen3:1.7b')).to.equal(KEEP_FOREVER);
            expect(keepAliveFor('library/qwen3:1.7b', '5m', 'qwen3:1.7b')).to.equal(KEEP_FOREVER);
        });

        it('uses the keep-alive of the settings for other models', () => {
            expect(keepAliveFor('llama3.2:3b', '5m', 'qwen3:1.7b')).to.equal('5m');
            expect(keepAliveFor('qwen3:1.7b', '5m', '')).to.equal('5m');
        });
    });
});
