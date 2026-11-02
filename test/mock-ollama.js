const http = require('node:http');

/**
 * A small imitation of the Ollama API for the integration tests, so they run without Docker and without
 * downloading a real model. It knows the endpoints the adapter uses and records every request.
 */

const MODEL_DETAILS = {
    'qwen3:0.6b': { size: 522_653_767, parameter_size: '751.63M' },
    'tiny:1b': { size: 1_000_000, parameter_size: '1B' },
};

function toModel(name) {
    const details = MODEL_DETAILS[name] || { size: 1, parameter_size: '1B' };
    return {
        name,
        model: name,
        modified_at: '2026-10-01T10:00:00Z',
        size: details.size,
        digest: 'sha256:0000',
        details: {
            format: 'gguf',
            family: 'qwen3',
            parameter_size: details.parameter_size,
            quantization_level: 'Q4_K_M',
        },
    };
}

function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
}

/**
 * Start the imitation on a free port of 127.0.0.1
 *
 * @param {string[]} installed names of the models that are downloaded at the start
 * @returns {Promise<{ url: string, models: Map<string, object>, running: Set<string>, requests: object[], close: () => Promise<void> }>}
 */
async function startMockOllama(installed) {
    const models = new Map(installed.map(name => [name, toModel(name)]));
    const running = new Set();
    const requests = [];

    function handle(method, url, body, res) {
        if (method === 'GET' && url === '/api/version') {
            return sendJson(res, 200, { version: '0.0.0-mock' });
        }
        if (method === 'GET' && url === '/api/tags') {
            return sendJson(res, 200, { models: [...models.values()] });
        }
        if (method === 'GET' && url === '/api/ps') {
            return sendJson(res, 200, {
                models: [...running].map(name => ({ ...toModel(name), expires_at: '2026-10-01T10:05:00Z' })),
            });
        }
        if (method === 'POST' && url === '/api/pull') {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            if (!MODEL_DETAILS[body.model]) {
                res.end(`${JSON.stringify({ error: 'pull model manifest: file does not exist' })}\n`);
                return;
            }
            const lines = [
                { status: 'pulling manifest' },
                { status: 'pulling 0000', digest: 'sha256:0000', total: 1000, completed: 0 },
                { status: 'pulling 0000', digest: 'sha256:0000', total: 1000, completed: 500 },
                { status: 'pulling 0000', digest: 'sha256:0000', total: 1000, completed: 1000 },
                { status: 'verifying sha256 digest' },
                { status: 'success' },
            ];
            models.set(body.model, toModel(body.model));
            res.end(lines.map(line => `${JSON.stringify(line)}\n`).join(''));
            return;
        }
        if (method === 'DELETE' && url === '/api/delete') {
            if (!models.delete(body.model)) {
                return sendJson(res, 404, { error: `model '${body.model}' not found` });
            }
            running.delete(body.model);
            res.writeHead(200);
            res.end();
            return;
        }
        if (method === 'POST' && (url === '/api/chat' || url === '/api/generate')) {
            if (!models.has(body.model)) {
                return sendJson(res, 404, { error: `model "${body.model}" not found, try pulling it first` });
            }
            if (url === '/api/generate' && body.prompt === undefined) {
                // load or unload the model
                if (body.keep_alive === 0) {
                    running.delete(body.model);
                } else {
                    running.add(body.model);
                }
                return sendJson(res, 200, { model: body.model, response: '', done: true });
            }
            running.add(body.model);
            const stats = { prompt_eval_count: 12, eval_count: 5, eval_duration: 500_000_000, done: true };
            if (url === '/api/chat') {
                return sendJson(res, 200, {
                    model: body.model,
                    message: { role: 'assistant', content: 'Hello from the mock' },
                    ...stats,
                });
            }
            return sendJson(res, 200, { model: body.model, response: '{"on":true}', ...stats });
        }
        sendJson(res, 404, { error: `unknown endpoint ${method} ${url}` });
    }

    const server = http.createServer((req, res) => {
        let text = '';
        req.on('data', chunk => (text += chunk));
        req.on('end', () => {
            let body = {};
            try {
                body = text ? JSON.parse(text) : {};
            } catch {
                return sendJson(res, 400, { error: 'invalid JSON' });
            }
            requests.push({ method: req.method, url: req.url, body });
            handle(req.method, req.url, body, res);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        models,
        running,
        requests,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}

module.exports = { startMockOllama };
