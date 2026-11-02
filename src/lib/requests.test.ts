import { expect } from 'chai';
import { shorten, toChatRequest, toGenerateRequest, toMetrics } from './requests';

const defaults = { model: 'qwen3:4b', keepAlive: '5m' };

describe('requests', () => {
    describe('toChatRequest', () => {
        it('uses the default model and the configured keep-alive', () => {
            const request = toChatRequest({ messages: [{ role: 'user', content: 'Hi' }] }, defaults);
            expect(request).to.deep.equal({
                model: 'qwen3:4b',
                messages: [{ role: 'user', content: 'Hi' }],
                keep_alive: '5m',
            });
        });

        it('takes the model of the message and puts the system prompt first', () => {
            const request = toChatRequest(
                { model: 'llama3.2:3b', system: 'Be brief', messages: [{ role: 'user', content: 'Hi' }] },
                { model: 'qwen3:4b', keepAlive: '-1' },
            );
            expect(request.model).to.equal('llama3.2:3b');
            expect(request.messages).to.deep.equal([
                { role: 'system', content: 'Be brief' },
                { role: 'user', content: 'Hi' },
            ]);
            expect(request.keep_alive).to.equal(-1);
        });

        it('passes tools, format, options, think and the tool calls of the messages unchanged', () => {
            const tools = [{ type: 'function', function: { name: 'switch', parameters: { type: 'object' } } }];
            const format = { type: 'object', properties: { on: { type: 'boolean' } } };
            const messages = [
                { role: 'user', content: 'Light on' },
                { role: 'assistant', content: '', tool_calls: [{ function: { name: 'switch', arguments: {} } }] },
                { role: 'tool', content: 'done', tool_name: 'switch' },
            ];
            const request = toChatRequest(
                { messages, tools, format, options: { temperature: 0 }, think: false },
                defaults,
            );
            expect(request.tools).to.equal(tools);
            expect(request.format).to.equal(format);
            expect(request.options).to.deep.equal({ temperature: 0 });
            expect(request.think).to.equal(false);
            expect(request.messages).to.deep.equal(messages);
        });

        it('rejects invalid messages with a clear text', () => {
            expect(() => toChatRequest(null, defaults)).to.throw('has to be an object');
            expect(() => toChatRequest({ messages: [] }, defaults)).to.throw('"messages" has to be a non-empty list');
            expect(() => toChatRequest({ messages: [{ role: 'bot', content: 'x' }] }, defaults)).to.throw(
                'messages[0]: "role"',
            );
            expect(() => toChatRequest({ messages: [{ role: 'user', content: 5 }] }, defaults)).to.throw(
                'messages[0]: "content"',
            );
            expect(() => toChatRequest({ messages: [{ role: 'user', content: 'x', images: [1] }] }, defaults)).to.throw(
                '"images"',
            );
            expect(() => toChatRequest({ system: 5, messages: [{ role: 'user', content: 'x' }] }, defaults)).to.throw(
                '"system" has to be a text',
            );
        });

        it('needs a model', () => {
            expect(() =>
                toChatRequest({ messages: [{ role: 'user', content: 'x' }] }, { model: '', keepAlive: '5m' }),
            ).to.throw('No model given');
        });
    });

    describe('toGenerateRequest', () => {
        it('builds the request with system prompt and parameters', () => {
            expect(toGenerateRequest({ prompt: 'Hi', system: 'Be brief', format: 'json' }, defaults)).to.deep.equal({
                model: 'qwen3:4b',
                prompt: 'Hi',
                system: 'Be brief',
                format: 'json',
                keep_alive: '5m',
            });
        });

        it('needs a prompt', () => {
            expect(() => toGenerateRequest({}, defaults)).to.throw('"prompt" has to be a non-empty text');
            expect(() => toGenerateRequest({ prompt: '' }, defaults)).to.throw('"prompt"');
        });
    });

    describe('toMetrics', () => {
        it('calculates the speed from eval_count and eval_duration', () => {
            expect(
                toMetrics({ prompt_eval_count: 21, eval_count: 136, eval_duration: 22_217_424_000 }, 22_460),
            ).to.deep.equal({ durationMs: 22_460, promptTokens: 21, completionTokens: 136, tokensPerSecond: 6.1 });
        });

        it('reports 0 for missing statistics', () => {
            expect(toMetrics({}, 5)).to.deep.equal({
                durationMs: 5,
                promptTokens: 0,
                completionTokens: 0,
                tokensPerSecond: 0,
            });
        });
    });

    describe('shorten', () => {
        it('puts the text on one line and cuts it', () => {
            expect(shorten('a\n  b')).to.equal('a b');
            expect(shorten('x'.repeat(250))).to.equal(`${'x'.repeat(200)}…`);
        });
    });
});
