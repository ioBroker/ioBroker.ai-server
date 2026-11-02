import { expect } from 'chai';
import { MODEL_STATES, parseModelCommand, toModelId } from './objects';

/** Copy of `FORBIDDEN_CHARS` of the js-controller, which the adapter passes */
const FORBIDDEN_CHARS = /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu;

describe('objects', () => {
    describe('toModelId', () => {
        it('replaces dots, colons and slashes', () => {
            expect(toModelId('qwen3:8b', FORBIDDEN_CHARS)).to.equal('qwen3_8b');
            expect(toModelId('llama3.2:latest', FORBIDDEN_CHARS)).to.equal('llama3_2_latest');
            expect(toModelId('hf.co/user/repo:Q4_K_M', FORBIDDEN_CHARS)).to.equal('hf_co_user_repo_Q4_K_M');
        });

        it('replaces the characters forbidden in object IDs', () => {
            expect(toModelId('a*b?c', FORBIDDEN_CHARS)).to.equal('a_b_c');
        });
    });

    describe('parseModelCommand', () => {
        it('recognizes the buttons of a model', () => {
            expect(parseModelCommand('models.qwen3_8b.load')).to.deep.equal({ id: 'qwen3_8b', command: 'load' });
            expect(parseModelCommand('models.qwen3_8b.unload')).to.deep.equal({ id: 'qwen3_8b', command: 'unload' });
        });

        it('ignores other states', () => {
            expect(parseModelCommand('models.qwen3_8b.loaded')).to.equal(null);
            expect(parseModelCommand('control.pull')).to.equal(null);
            expect(parseModelCommand('models.a.b.load')).to.equal(null);
        });
    });

    describe('MODEL_STATES', () => {
        it('defines the buttons as write-only and the values as read-only', () => {
            for (const [key, common] of Object.entries(MODEL_STATES)) {
                const button = common.role === 'button';
                expect(button, key).to.equal(key === 'load' || key === 'unload');
                expect(common.read, key).to.equal(!button);
                expect(common.write, key).to.equal(button);
            }
            expect(MODEL_STATES.size.unit).to.equal('B');
        });
    });
});
