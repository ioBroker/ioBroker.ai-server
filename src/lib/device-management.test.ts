import { join } from 'node:path';
import type { AdapterInstance } from '@iobroker/adapter-core';
import * as I18n from '@iobroker/adapter-core/i18n';
import { expect } from 'chai';
import { type ModelBackend, ModelManagement } from './device-management';
import type { ModelInfo } from './models';

/**
 * Enough of an adapter for the device manager. `send` plays the GUI: it sends a message and returns the answer.
 */
class FakeAdapter {
    public readonly namespace = 'ai-server.0';
    public readonly log = {
        silly: (): void => {},
        debug: (): void => {},
        info: (): void => {},
        warn: (): void => {},
        error: (): void => {},
    };
    readonly #handlers: ((message: ioBroker.Message) => void)[] = [];
    #answer: ((message: any) => void) | null = null;
    #nextId = 1;

    public on(event: string, handler: (message: ioBroker.Message) => void): void {
        if (event === 'message') {
            this.#handlers.push(handler);
        }
    }

    public sendTo(_target: string, _command: string, message: unknown): void {
        const answer = this.#answer;
        this.#answer = null;
        answer?.(message);
    }

    public setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
        return setTimeout(callback, ms);
    }

    public send(command: string, message: unknown): Promise<any> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`No answer to ${command}`)), 5000);
            this.#answer = answer => {
                clearTimeout(timer);
                resolve(answer);
            };
            const id = this.#nextId++;
            for (const handler of this.#handlers) {
                handler({
                    _id: id,
                    command,
                    message,
                    from: 'system.adapter.admin.0',
                    callback: { message, id, ack: false, time: Date.now() },
                });
            }
        });
    }
}

const MODELS: ModelInfo[] = [
    { name: 'qwen3:4b', size: 2_497_293_931, parameterSize: '4.0B', quantization: 'Q4_K_M', loaded: true },
    { name: 'llama3.2:3b', size: 2_019_393_189, parameterSize: '3.2B', quantization: 'Q4_K_M', loaded: false },
];
const DAY = 24 * 60 * 60 * 1000;

function createBackend(): ModelBackend & { calls: string[]; pullResult: (() => Promise<void>) | null } {
    const backend = {
        calls: [] as string[],
        pullResult: null as (() => Promise<void>) | null,
        listModels: () => Promise.resolve(MODELS),
        getChannelId: (name: string) => `ai-server.0.models.${name.replace(/[.:]/g, '_')}`,
        getLastUsed: (name: string) => (name === 'qwen3:4b' ? Date.now() : Date.now() - 12 * DAY - 1000),
        getSettings: () => ({ defaultModel: 'qwen3:4b', deleteUnusedDays: 30, requestTimeoutMs: 300_000 }),
        setLoaded: (name: string, load: boolean) => {
            backend.calls.push(`${load ? 'load' : 'unload'} ${name}`);
            return Promise.resolve();
        },
        deleteModel: (name: string) => {
            backend.calls.push(`delete ${name}`);
            return name === 'fails:1b' ? Promise.reject(new Error('model not found')) : Promise.resolve();
        },
        pull: (name: string, onProgress: (percent: number | null, status: string) => void) => {
            backend.calls.push(`pull ${name}`);
            onProgress(null, 'pulling manifest');
            onProgress(40, 'pulling 6a0746a1ec1a');
            return backend.pullResult ? backend.pullResult() : Promise.resolve();
        },
    };
    return backend;
}

describe('device-management', () => {
    let adapter: FakeAdapter;
    let backend: ReturnType<typeof createBackend>;

    before(async () => {
        await I18n.init(join(__dirname, '..', '..', 'admin'), 'en');
    });

    beforeEach(() => {
        adapter = new FakeAdapter();
        backend = createBackend();
        new ModelManagement(adapter as unknown as AdapterInstance, backend);
    });

    it('offers the download and shows the size of all models', async () => {
        const info = await adapter.send('dm:instanceInfo', null);
        expect(info.apiVersion).to.equal('v3');
        expect(info.actions.map((action: any) => action.id)).to.deep.equal(['pull']);
        expect(info.indicators[0].text.en).to.equal('All models: 4.5 GB');
        expect(info.indicators[0].text.de).to.equal('Alle Modelle: 4.5 GB');
    });

    it('shows a card per model', async () => {
        const answer = await adapter.send('dm:loadDevices', null);
        expect(answer.total).to.equal(2);
        expect(answer.next).to.equal(undefined);
        const [llama, qwen] = answer.add;
        expect(llama.id).to.equal('llama3.2:3b');
        expect(llama.model).to.equal('3.2B · Q4_K_M');
        expect(llama.actions.map((action: any) => action.id)).to.deep.equal(['load', 'unload', 'delete']);
        expect(llama.actions[2].confirmation.en).to.equal(
            'Delete llama3.2:3b? This frees 2.0 GB on the disk. The model can be downloaded again at any time.',
        );
        expect(llama.indicators).to.deep.equal([
            {
                id: 'loaded',
                value: { stateId: 'ai-server.0.models.llama3_2_3b.loaded' },
                icon: 'play',
                color: 'ok',
                tooltip: llama.indicators[0].tooltip,
            },
        ]);
        const items = llama.customInfo.schema.items;
        expect(items.size.data).to.equal('2.0 GB');
        expect(items.lastUsed.data.en).to.equal('12 days ago');
        expect(items.autoDelete.data.en).to.equal('in 18 days');

        // the default model is marked and never deleted automatically
        expect(qwen.indicators.map((indicator: any) => indicator.id)).to.deep.equal(['loaded', 'default']);
        expect(qwen.customInfo.schema.items.lastUsed.data.en).to.equal('today');
        expect(qwen.customInfo.schema.items.autoDelete.data.en).to.equal('never (default model)');
        expect(qwen.actions[2].confirmation.en).to.match(/^qwen3:4b is the default model/);
    });

    it('loads, unloads and deletes a model', async () => {
        await adapter.send('dm:loadDevices', null);
        const load = await adapter.send('dm:deviceAction', { deviceId: 'llama3.2:3b', actionId: 'load' });
        expect(load).to.include({ type: 'result' });
        expect(load.result).to.deep.equal({ refresh: 'devices' });
        const unload = await adapter.send('dm:deviceAction', { deviceId: 'qwen3:4b', actionId: 'unload' });
        expect(unload.result).to.deep.equal({ refresh: 'none' });
        const deleted = await adapter.send('dm:deviceAction', { deviceId: 'llama3.2:3b', actionId: 'delete' });
        expect(deleted.result).to.deep.equal({ refresh: 'all' });
        expect(backend.calls).to.deep.equal(['load llama3.2:3b', 'unload qwen3:4b', 'delete llama3.2:3b']);
    });

    it('downloads a model and reports the progress', async function () {
        this.timeout(10_000);
        await adapter.send('dm:instanceInfo', null);
        let resolvePull = (): void => {};
        const pullResult = new Promise<void>(resolve => {
            resolvePull = resolve;
        });
        backend.pullResult = () => pullResult;

        const form = await adapter.send('dm:instanceAction', { actionId: 'pull' });
        expect(form.type).to.equal('form');
        // the downloaded models are not offered again
        const options = form.form.schema.items.model.options.map((option: any) => option.value);
        expect(options).to.include('qwen3:1.7b');
        expect(options).to.not.include('qwen3:4b');

        const origin = form.origin;
        let answer = await adapter.send('dm:actionProgress', { origin, data: { model: ' qwen3:1.7b ' } });
        expect(answer.progress).to.include({ open: true, value: 0 });
        expect(answer.progress.title.en).to.equal('Downloading qwen3:1.7b');

        const labels: string[] = [];
        // the GUI confirms every progress message at once and expects the next one within 5 seconds
        for (let i = 0; answer.type === 'progress'; i++) {
            if (answer.progress.label) {
                labels.push(answer.progress.label);
            }
            if (i === 2) {
                resolvePull();
            }
            const started = Date.now();
            answer = await adapter.send('dm:actionProgress', { origin });
            expect(Date.now() - started).to.be.below(2000);
        }
        expect(labels[0]).to.equal('0 %');
        expect(labels).to.include('40 %');
        expect(answer).to.deep.include({ type: 'result', result: { refresh: true } });
        expect(backend.calls).to.deep.equal(['pull qwen3:1.7b']);
    });

    it('reports a failed download', async function () {
        this.timeout(10_000);
        await adapter.send('dm:instanceInfo', null);
        backend.pullResult = () => Promise.reject(new Error('file does not exist'));
        const form = await adapter.send('dm:instanceAction', { actionId: 'pull' });
        let answer = await adapter.send('dm:actionProgress', { origin: form.origin, data: { model: 'nothing:1b' } });
        while (answer.type === 'progress') {
            answer = await adapter.send('dm:actionProgress', { origin: form.origin });
        }
        expect(answer.type).to.equal('message');
        expect(answer.message.en).to.equal('The download of nothing:1b failed: file does not exist');
        answer = await adapter.send('dm:actionProgress', { origin: form.origin });
        expect(answer).to.deep.include({ type: 'result', result: { refresh: false } });
    });

    it('does not download without a valid name', async () => {
        await adapter.send('dm:instanceInfo', null);
        const form = await adapter.send('dm:instanceAction', { actionId: 'pull' });
        let answer = await adapter.send('dm:actionProgress', { origin: form.origin, data: { model: 'bad name' } });
        expect(answer.message.en).to.equal('Invalid model name: bad name');
        answer = await adapter.send('dm:actionProgress', { origin: form.origin });
        expect(answer.result).to.deep.equal({ refresh: false });

        // cancelled dialog
        const second = await adapter.send('dm:instanceAction', { actionId: 'pull' });
        answer = await adapter.send('dm:actionProgress', { origin: second.origin, data: undefined });
        expect(answer.result).to.deep.equal({ refresh: false });
        expect(backend.calls).to.deep.equal([]);
    });
});
