import { expect } from 'chai';
import {
    isValidModelName,
    NdjsonParser,
    OllamaClient,
    OllamaError,
    type OllamaPullStatus,
    PullProgress,
    toKeepAlive,
} from './ollama-client';

interface FetchCall {
    url: string;
    method?: string;
    body?: unknown;
}

/**
 * A fetch that answers every request with the given function and records the calls
 *
 * @param answer creates the response for a call
 */
function fakeFetch(answer: (call: FetchCall) => Response | Promise<Response>): {
    fetch: typeof fetch;
    calls: FetchCall[];
} {
    const calls: FetchCall[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const call: FetchCall = {
            url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            method: init?.method,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        };
        calls.push(call);
        return answer(call);
    }) as typeof fetch;
    return { fetch: fn, calls };
}

/**
 * A fetch that never answers, until the request is aborted
 *
 * @param _input URL of the request
 * @param init options of the request with the abort signal
 */
const hangingFetch = ((_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A response whose body arrives in the given chunks
 *
 * @param chunks the parts of the body, as they are sent
 */
function stream(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
    );
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('The promise was not rejected');
}

describe('ollama-client', () => {
    describe('isValidModelName', () => {
        it('accepts the usual model names', () => {
            for (const name of ['qwen3:8b', 'llama3.2', 'library/llama3.2:latest', 'hf.co/user/model:Q4_K_M']) {
                expect(isValidModelName(name), name).to.equal(true);
            }
        });

        it('rejects everything else', () => {
            for (const name of ['', 'qwen3 8b', 'a;rm -rf', '../x?y', 'mod"el', 42, null, undefined]) {
                expect(isValidModelName(name), String(name)).to.equal(false);
            }
        });
    });

    describe('toKeepAlive', () => {
        it('sends durations as string and plain numbers as number', () => {
            expect(toKeepAlive('5m')).to.equal('5m');
            expect(toKeepAlive('1h30m')).to.equal('1h30m');
            expect(toKeepAlive('-1')).to.equal(-1);
            expect(toKeepAlive('0')).to.equal(0);
            expect(toKeepAlive(300)).to.equal(300);
            expect(toKeepAlive('')).to.equal('5m');
        });
    });

    describe('NdjsonParser', () => {
        it('returns complete lines only and keeps the rest for the next chunk', () => {
            const parser = new NdjsonParser();
            expect(parser.push('{"a":1}\n{"b":')).to.deep.equal([{ a: 1 }]);
            expect(parser.push('2}\r\n\n{"c":3}\n')).to.deep.equal([{ b: 2 }, { c: 3 }]);
            expect(parser.flush()).to.deep.equal([]);
        });

        it('returns the last line without line break on flush', () => {
            const parser = new NdjsonParser();
            expect(parser.push('{"a":1}\n{"b":2}')).to.deep.equal([{ a: 1 }]);
            expect(parser.flush()).to.deep.equal([{ b: 2 }]);
        });

        it('throws on an invalid line', () => {
            const parser = new NdjsonParser();
            expect(() => parser.push('{"a":\n')).to.throw(OllamaError);
        });
    });

    describe('PullProgress', () => {
        it('ignores messages without size', () => {
            const progress = new PullProgress();
            expect(progress.update({ status: 'pulling manifest' })).to.equal(null);
            expect(progress.update({ status: 'pulling abc', digest: 'abc' })).to.equal(null);
        });

        it('calculates the progress over all layers', () => {
            const progress = new PullProgress();
            expect(progress.update({ digest: 'a', total: 1000, completed: 0 })).to.equal(0);
            expect(progress.update({ digest: 'a', total: 1000, completed: 500 })).to.equal(50);
            // a second, small layer does not let the progress jump back to 0
            expect(progress.update({ digest: 'b', total: 1000 })).to.equal(25);
            expect(progress.update({ digest: 'b', total: 1000, completed: 1000 })).to.equal(75);
        });

        it('reports 100 only on success', () => {
            const progress = new PullProgress();
            expect(progress.update({ digest: 'a', total: 10, completed: 10 })).to.equal(99);
            expect(progress.update({ status: 'verifying sha256 digest' })).to.equal(null);
            expect(progress.update({ status: 'success' })).to.equal(100);
        });
    });

    describe('OllamaClient', () => {
        it('removes a trailing slash from the base URL', async () => {
            const { fetch, calls } = fakeFetch(() => json({ version: '0.40.11' }));
            const client = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434/', timeoutMs: 1000, fetch });
            expect(await client.getVersion()).to.equal('0.40.11');
            expect(calls).to.deep.equal([
                { url: 'http://127.0.0.1:11434/api/version', method: 'GET', body: undefined },
            ]);
        });

        it('reads the model lists', async () => {
            const { fetch } = fakeFetch(call =>
                call.url.endsWith('/api/tags')
                    ? json({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', size: 5 }] })
                    : json({ models: [] }),
            );
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            expect((await client.listModels()).map(m => m.name)).to.deep.equal(['qwen3:8b']);
            expect(await client.listRunningModels()).to.deep.equal([]);
        });

        it('reports the error text of Ollama', async () => {
            const { fetch } = fakeFetch(() => json({ error: 'model "x" not found' }, 404));
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const error = (await rejection(client.deleteModel('x'))) as OllamaError;
            expect(error).to.be.instanceOf(OllamaError);
            expect(error.message).to.equal('model "x" not found');
            expect(error.status).to.equal(404);
        });

        it('reports an unreachable server', async () => {
            const fetch = (() =>
                Promise.reject(
                    new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }),
                )) as typeof globalThis.fetch;
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const error = await rejection(client.getVersion());
            expect(error.message).to.equal('Cannot reach Ollama at http://x: ECONNREFUSED');
        });

        it('aborts a request after the timeout', async () => {
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 20, fetch: hangingFetch });
            const error = await rejection(client.getVersion());
            expect(error.message).to.equal('Ollama did not answer within 0 s');
        });

        it('aborts all running requests', async () => {
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 60000, fetch: hangingFetch });
            const running = rejection(client.getVersion());
            client.abortAll();
            expect((await running).message).to.equal('The request to Ollama was aborted');
        });

        it('checks the model name before sending anything', async () => {
            const { fetch, calls } = fakeFetch(() => json({}));
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const error = await rejection(client.loadModel('bad name', '5m'));
            expect(error).to.be.instanceOf(OllamaError);
            expect(calls).to.have.length(0);
        });

        it('loads and unloads a model', async () => {
            const { fetch, calls } = fakeFetch(() => json({ done: true }));
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            await client.loadModel('qwen3:8b', '-1');
            await client.unloadModel('qwen3:8b');
            expect(calls.map(c => c.body)).to.deep.equal([
                { model: 'qwen3:8b', keep_alive: -1 },
                { model: 'qwen3:8b', keep_alive: 0 },
            ]);
        });

        it('sends chat and generate without streaming', async () => {
            const { fetch, calls } = fakeFetch(call =>
                call.url.endsWith('/api/chat')
                    ? json({ model: 'm', message: { role: 'assistant', content: 'Hi' }, done: true })
                    : json({ model: 'm', response: 'Hi', done: true }),
            );
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const chat = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'Hello' }] });
            const generate = await client.generate({ model: 'm', prompt: 'Hello' });
            expect(chat.message.content).to.equal('Hi');
            expect(generate.response).to.equal('Hi');
            expect(calls.map(c => (c.body as { stream: boolean }).stream)).to.deep.equal([false, false]);
        });

        it('pulls a model and reports the progress', async () => {
            const { fetch, calls } = fakeFetch(() =>
                stream([
                    '{"status":"pulling manifest"}\n{"status":"pulling a","digest":"a","total":100}\n',
                    '{"status":"pulling a","digest":"a","total":100,"comp',
                    'leted":50}\n{"status":"verifying sha256 digest"}\n{"status":"success"}',
                ]),
            );
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const seen: [string | undefined, number | null][] = [];
            await client.pull('qwen3:8b', (status: OllamaPullStatus, percent) => seen.push([status.status, percent]));
            expect(calls[0].body).to.deep.equal({ model: 'qwen3:8b', stream: true });
            expect(seen).to.deep.equal([
                ['pulling manifest', null],
                ['pulling a', 0],
                ['pulling a', 50],
                ['verifying sha256 digest', null],
                ['success', 100],
            ]);
        });

        it('fails a pull on an error message in the stream', async () => {
            const { fetch } = fakeFetch(() =>
                stream(['{"status":"pulling manifest"}\n{"error":"pull model manifest: file does not exist"}\n']),
            );
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const error = await rejection(client.pull('nothing'));
            expect(error.message).to.equal('pull model manifest: file does not exist');
        });

        it('fails a pull that ends without success', async () => {
            const { fetch } = fakeFetch(() => stream(['{"status":"pulling manifest"}\n']));
            const client = new OllamaClient({ baseUrl: 'http://x', timeoutMs: 1000, fetch });
            const error = await rejection(client.pull('qwen3:8b'));
            expect(error.message).to.equal('The download of qwen3:8b ended without success');
        });
    });
});
