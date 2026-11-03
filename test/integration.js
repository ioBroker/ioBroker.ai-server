const path = require('path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');
const { DockerManager } = require('@iobroker/plugin-docker');
const { startMockOllama } = require('./mock-ollama');

const INSTANCE = 'ai-server.0';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait until `check` returns a truthy value and return it
 *
 * @param {() => Promise<any>} check the condition
 * @param {number} timeoutMs time until the test fails
 * @param {string} what description for the error message
 */
async function waitFor(check, timeoutMs, what) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) {
            return value;
        }
        if (Date.now() > end) {
            throw new Error(`Timeout while waiting for ${what}`);
        }
        await delay(250);
    }
}

/** Same check as the adapter does, so the test knows which result to expect on this host */
async function isDockerAvailable() {
    const ignore = () => {};
    const logger = { silly: ignore, debug: ignore, info: ignore, warn: ignore, error: ignore, level: 'error' };
    const manager = new DockerManager({ logger, namespace: INSTANCE, quiet: true });
    await manager.isReady();
    const info = await manager.getDockerDaemonInfo().catch(() => null);
    return !!info?.daemonRunning;
}

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Backend Docker', getHarness => {
            let harness;
            let docker;
            const getState = id => harness.states.getStateAsync(`${INSTANCE}.${id}`);
            const sendTo = (command, message) =>
                new Promise(resolve => harness.sendTo(INSTANCE, command, message, resolve));

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                docker = await isDockerAvailable();
                console.log(`Docker is ${docker ? '' : 'not '}available on this host`);
            });

            it('reports a missing Docker without crashing, or connects to the container', async function () {
                // the first start pulls the image of Ollama
                this.timeout(10 * 60_000);
                await harness.startAdapterAndWait();
                if (docker) {
                    await waitFor(
                        async () => (await getState('info.connection'))?.val === true,
                        9 * 60_000,
                        'the connection to the container',
                    );
                    const { result } = await sendTo('status', {});
                    expect(result).to.include({ connected: true, baseUrl: 'http://127.0.0.1:11434' });
                    expect(result.version).to.be.a('string').that.is.not.empty;
                    return;
                }
                await waitFor(
                    async () => (await getState('info.status'))?.val === 'error',
                    60_000,
                    'info.status = error',
                );
                expect((await getState('info.lastError')).val).to.match(/Docker/);
                expect((await getState('info.connection')).val).to.equal(false);
                expect(harness.hasLog(/External Ollama server/, 'error')).to.be.true;

                // the adapter keeps running and answers
                await delay(3000);
                expect(harness.isAdapterRunning()).to.be.true;
                const { result } = await sendTo('status', {});
                expect(result).to.include({ connected: false, status: 'error' });
                const answer = await sendTo('chat', { messages: [{ role: 'user', content: 'Hello' }] });
                expect(answer.error).to.match(/not available/);
            });

            it('names the endpoint for other adapters', async () => {
                const { result } = await sendTo('getEndpoint', {});
                expect(result).to.deep.equal({
                    ollama: 'http://127.0.0.1:11434',
                    openai: 'http://127.0.0.1:11434/v1',
                });
            });
        });

        suite('Backend external Ollama server', getHarness => {
            let harness;
            let mock;
            const getState = id => harness.states.getStateAsync(`${INSTANCE}.${id}`);
            const getObject = id => harness.objects.getObjectAsync(`${INSTANCE}.${id}`);
            const setCommand = (id, val) => harness.states.setStateAsync(`${INSTANCE}.${id}`, { val, ack: false });
            const sendTo = (command, message) =>
                new Promise(resolve => harness.sendTo(INSTANCE, command, message, resolve));
            const lastRequest = url => [...mock.requests].reverse().find(request => request.url === url);

            before(async () => {
                harness = getHarness();
                mock = await startMockOllama(['qwen3:0.6b']);
                await harness.changeAdapterConfig('ai-server', {
                    native: {
                        backend: 'external',
                        // the trailing slash is removed by the adapter
                        externalUrl: `${mock.url}/`,
                        dockerCpu: false,
                        dockerRocm: false,
                        defaultModel: 'qwen3:0.6b',
                    },
                });
            });

            after(async () => {
                await mock?.close();
            });

            it('connects to the server', async function () {
                this.timeout(60_000);
                await harness.startAdapterAndWait(true);
                // info.connection is written just before info.status
                await waitFor(async () => (await getState('info.status'))?.val === 'ready', 5000, 'info.status = ready');
                expect((await getState('info.backendVersion')).val).to.equal('0.0.0-mock');
            });

            it('creates the objects of the downloaded models', async function () {
                this.timeout(10_000);
                const channel = await waitFor(
                    () => getObject('models.qwen3_0_6b'),
                    5000,
                    'the channel of the model',
                );
                expect(channel.type).to.equal('channel');
                expect((await getState('models.qwen3_0_6b.name')).val).to.equal('qwen3:0.6b');
                expect((await getState('models.qwen3_0_6b.size')).val).to.equal(522_653_767);
                expect((await getState('models.qwen3_0_6b.parameterSize')).val).to.equal('751.63M');
                expect((await getState('models.qwen3_0_6b.quantization')).val).to.equal('Q4_K_M');
                expect((await getState('models.qwen3_0_6b.loaded')).val).to.equal(false);
            });

            it('answers status, getEndpoint and listModels', async () => {
                expect((await sendTo('status', {})).result).to.deep.equal({
                    connected: true,
                    status: 'ready',
                    version: '0.0.0-mock',
                    baseUrl: mock.url,
                    loadedModels: [],
                });
                expect((await sendTo('getEndpoint', {})).result).to.deep.equal({
                    ollama: mock.url,
                    openai: `${mock.url}/v1`,
                });
                expect((await sendTo('listModels', {})).result).to.deep.equal([
                    {
                        name: 'qwen3:0.6b',
                        size: 522_653_767,
                        parameterSize: '751.63M',
                        quantization: 'Q4_K_M',
                        loaded: false,
                    },
                ]);
            });

            it('chats with the default model and writes the metrics', async function () {
                this.timeout(10_000);
                const { result } = await sendTo('chat', {
                    system: 'Be brief',
                    messages: [{ role: 'user', content: 'Secret question' }],
                });
                expect(result).to.include({
                    model: 'qwen3:0.6b',
                    promptTokens: 12,
                    completionTokens: 5,
                    tokensPerSecond: 10,
                });
                expect(result.message).to.deep.equal({ role: 'assistant', content: 'Hello from the mock' });
                expect(lastRequest('/api/chat').body).to.deep.equal({
                    model: 'qwen3:0.6b',
                    messages: [
                        { role: 'system', content: 'Be brief' },
                        { role: 'user', content: 'Secret question' },
                    ],
                    keep_alive: '5m',
                    stream: false,
                });
                await waitFor(
                    async () => (await getState('metrics.tokensPerSecond'))?.val === 10,
                    5000,
                    'metrics.tokensPerSecond',
                );
                expect((await getState('metrics.promptTokens')).val).to.equal(12);
                expect((await getState('metrics.completionTokens')).val).to.equal(5);
                expect((await getState('info.status')).val).to.equal('ready');
                // prompts appear on debug level only
                expect(harness.hasLog('Secret question', 'info')).to.be.false;
            });

            it('passes format to generate unchanged', async () => {
                const { result } = await sendTo('generate', { prompt: 'Light on?', format: 'json' });
                expect(result).to.include({ response: '{"on":true}', model: 'qwen3:0.6b' });
                expect(lastRequest('/api/generate').body).to.include({ format: 'json', stream: false });
            });

            it('answers wrong requests with an error', async () => {
                expect((await sendTo('chat', { messages: [] })).error).to.match(/"messages"/);
                const unknown = await sendTo('chat', { model: 'missing:1b', messages: [{ role: 'user', content: 'x' }] });
                expect(unknown.error).to.match(/not found/);
                expect((await sendTo('pull', { model: 'bad name' })).error).to.match(/Invalid model name/);
                expect((await sendTo('noSuchCommand', {})).error).to.match(/Unknown command/);
            });

            it('chats via the states', async function () {
                this.timeout(10_000);
                await setCommand('chat.system', 'Answer in German');
                await setCommand('chat.prompt', 'Hello');
                await waitFor(
                    async () => {
                        const state = await getState('chat.response');
                        return state?.ack && state.val === 'Hello from the mock';
                    },
                    5000,
                    'chat.response',
                );
                expect(lastRequest('/api/chat').body).to.deep.include({
                    model: 'qwen3:0.6b',
                    messages: [
                        { role: 'system', content: 'Answer in German' },
                        { role: 'user', content: 'Hello' },
                    ],
                    think: false,
                });
                await waitFor(async () => (await getState('chat.running'))?.val === false, 5000, 'chat.running');
            });

            it('unloads and loads a model with the buttons', async function () {
                this.timeout(10_000);
                await setCommand('models.qwen3_0_6b.unload', true);
                await waitFor(
                    async () => (await getState('models.qwen3_0_6b.loaded'))?.val === false && !mock.running.size,
                    5000,
                    'the model to be unloaded',
                );
                await setCommand('models.qwen3_0_6b.load', true);
                await waitFor(
                    async () => (await getState('models.qwen3_0_6b.loaded'))?.val === true,
                    5000,
                    'the model to be loaded',
                );
                expect(lastRequest('/api/generate').body).to.deep.equal({ model: 'qwen3:0.6b', keep_alive: '5m' });
            });

            it('downloads a model and shows the progress', async function () {
                this.timeout(10_000);
                expect((await sendTo('pull', { model: 'tiny:1b' })).result).to.deep.equal({ started: true });
                await waitFor(() => getObject('models.tiny_1b'), 5000, 'the channel of the new model');
                expect((await getState('control.pullProgress')).val).to.equal(100);
                expect((await getState('control.pull')).val).to.equal('tiny:1b');
            });

            it('reports a failed download in info.lastError', async function () {
                this.timeout(10_000);
                await setCommand('control.pull', 'unknown:7b');
                await waitFor(
                    async () => /unknown:7b.*file does not exist/.test((await getState('info.lastError'))?.val),
                    5000,
                    'info.lastError',
                );
                expect((await getState('control.pullProgress')).val).to.equal(0);
            });

            it('deletes a model together with its objects', async function () {
                this.timeout(10_000);
                expect((await sendTo('deleteModel', { model: 'tiny:1b' })).result).to.deep.equal({ deleted: true });
                expect(mock.models.has('tiny:1b')).to.be.false;
                await waitFor(async () => !(await getObject('models.tiny_1b')), 5000, 'the channel to be deleted');
                expect(await getObject('models.tiny_1b.name')).to.not.exist;
                expect(await getObject('models.qwen3_0_6b')).to.exist;
            });

            it('remembers the last use of a model', async () => {
                // the model answered the chats above
                const state = await getState('models.qwen3_0_6b.lastUsed');
                expect(state.val).to.be.a('number').within(Date.now() - 5 * 60_000, Date.now());
                expect((await getObject('models.qwen3_0_6b.lastUsed')).common).to.include({
                    type: 'number',
                    role: 'date',
                    write: false,
                });
            });

            it('shows the models in the device manager', async () => {
                const info = await sendTo('dm:instanceInfo', null);
                expect(info.apiVersion).to.equal('v3');
                expect(info.actions.map(action => action.id)).to.deep.equal(['pull']);
                expect(info.indicators[0].text.en).to.equal('All models: 523 MB');

                const devices = await sendTo('dm:loadDevices', null);
                expect(devices.add.map(device => device.id)).to.deep.equal(['qwen3:0.6b']);
                const [card] = devices.add;
                expect(card.actions.map(action => action.id)).to.deep.equal(['load', 'unload', 'delete']);
                expect(card.indicators.find(indicator => indicator.id === 'loaded').value).to.deep.equal({
                    stateId: `${INSTANCE}.models.qwen3_0_6b.loaded`,
                });
                // qwen3:0.6b is the default model of this instance
                expect(card.indicators.some(indicator => indicator.id === 'default')).to.be.true;
                expect(card.customInfo.schema.items.lastUsed.data.en).to.equal('today');
            });

            it('deletes a model in the device manager', async function () {
                this.timeout(10_000);
                await sendTo('pull', { model: 'tiny:1b' });
                await waitFor(() => getObject('models.tiny_1b'), 5000, 'the channel of the new model');
                // the GUI always reads the list before it offers the buttons
                await sendTo('dm:loadDevices', null);
                const answer = await sendTo('dm:deviceAction', { deviceId: 'tiny:1b', actionId: 'delete' });
                expect(answer).to.deep.include({ type: 'result', result: { refresh: 'all' } });
                expect(mock.models.has('tiny:1b')).to.be.false;
                await waitFor(async () => !(await getObject('models.tiny_1b')), 5000, 'the channel to be deleted');
            });
        });
    },
});
