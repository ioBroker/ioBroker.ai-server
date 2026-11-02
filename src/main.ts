/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';
import { type ModelInfo, modelOptions, sameModel, toModelInfos } from './lib/models';
import { MODEL_STATES, parseModelCommand, toModelId } from './lib/objects';
import { isValidModelName, OllamaClient, type OllamaRunningModel } from './lib/ollama-client';

/** First and maximal delay between two attempts to reach Ollama */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;
/** After this time without answer, the log explains why the adapter is still waiting */
const WAIT_INFO_AFTER_MS = 60_000;
/** Interval of the connection check via /api/ps */
const MONITOR_INTERVAL_MS = 30_000;
/** Timeout of the short requests that only check whether Ollama answers */
const PROBE_TIMEOUT_MS = 5_000;
/** The progress of a download is written at most this often */
const PULL_PROGRESS_INTERVAL_MS = 1_000;

type Status = 'starting' | 'ready' | 'busy' | 'error' | 'stopped';

/** The part of `@iobroker/plugin-docker` that is used here */
interface DockerPlugin {
    getDockerManager(): {
        getDockerDaemonInfo(): Promise<{ daemonRunning?: boolean; version?: string }>;
    } | null;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The model named in a message of sendTo
 *
 * @param message e.g. `{ model: "qwen3:4b" }`
 */
function getModel(message: unknown): string {
    const model = message && typeof message === 'object' ? (message as { model?: unknown }).model : undefined;
    if (typeof model !== 'string' || !model.trim()) {
        throw new Error('The message has to name the model, e.g. { model: "qwen3:4b" }');
    }
    return model.trim();
}

class AiServer extends utils.Adapter {
    #client: OllamaClient | null = null;
    #connected = false;
    #unloading = false;
    #retryTimer: ioBroker.Timeout | undefined;
    #monitorTimer: ioBroker.Interval | undefined;
    #monitorRunning = false;
    #subscribed = false;
    /** Names of the models by object ID, as of the last refresh */
    #models = new Map<string, string>();
    /** Refreshes run one after another, so that two of them do not create and delete the same objects */
    #refreshQueue: Promise<unknown> = Promise.resolve();
    /** The model being downloaded. Only one download runs at a time, as there is one progress state */
    #pulling: string | null = null;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'ai-server',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     * The container itself is started by plugin-docker (see docker-compose.yaml), not by the adapter.
     * The plugin is initialized before this method is called, so a missing image is already pulled.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);
        await this.#setStatus('starting');

        const baseUrl = this.#getBaseUrl();
        if (!baseUrl) {
            await this.#setError(
                `Invalid URL of the external Ollama server: "${this.config.externalUrl}". Expected e.g. http://192.168.1.50:11434`,
            );
            return;
        }

        if (this.config.backend === 'docker') {
            if (this.config.bind === '0.0.0.0') {
                this.log.warn(
                    `Ollama is reachable on port ${this.config.port} from the whole network. Ollama has no authentication: everyone in the network can use and change it.`,
                );
            }
            const dockerError = await this.#checkDocker();
            if (dockerError) {
                await this.#setError(dockerError);
                return;
            }
        }

        this.#client = new OllamaClient({
            baseUrl,
            timeoutMs: (Number(this.config.requestTimeout) || 300) * 1000,
            timers: {
                setTimeout: (callback, ms) => this.setTimeout(callback, ms),
                clearTimeout: handle => this.clearTimeout(handle as ioBroker.Timeout | undefined),
            },
        });
        this.log.info(`Waiting for Ollama at ${baseUrl}`);
        this.#waitForOllama();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private async onUnload(callback: () => void): Promise<void> {
        try {
            this.#unloading = true;
            this.#client?.abortAll();
            this.#stopMonitor();
            this.clearTimeout(this.#retryTimer);
            await this.setState('info.connection', false, true);
            await this.#setStatus('stopped');
        } catch (error) {
            this.log.error(`Error during unloading: ${errorText(error)}`);
        } finally {
            callback();
        }
    }

    /**
     * Commands written into the states: `control.pull`, `control.refresh` and the buttons of the models
     *
     * @param id full state ID
     * @param state the new state, only commands (`ack: false`) are handled
     */
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack) {
            return;
        }
        const localId = id.substring(this.namespace.length + 1);
        try {
            if (localId === 'control.pull') {
                const model = typeof state.val === 'string' ? state.val.trim() : '';
                if (model) {
                    // acknowledged by the download itself
                    this.#startPull(model);
                } else {
                    await this.setState(localId, '', true);
                }
            } else if (localId === 'control.refresh') {
                await this.setState(localId, state.val, true);
                await this.#refreshModels();
            } else {
                const command = parseModelCommand(localId);
                if (!command || !state.val) {
                    return;
                }
                await this.setState(localId, state.val, true);
                const model = this.#models.get(command.id);
                if (!model) {
                    throw new Error('Ollama does not have this model any more');
                }
                await this.#setLoaded(model, command.command === 'load');
            }
        } catch (error) {
            await this.#reportError(`${localId}: ${errorText(error)}`);
        }
    }

    /**
     * The sendTo API. Every message with a callback is answered, with `{ result }` or `{ error }`
     *
     * @param obj the message
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command) {
            return;
        }
        let answer: unknown;
        if (obj.command === 'getModelOptions') {
            // the choice of the default model in the instance settings expects a plain list
            answer = modelOptions(await this.#refreshModels().catch(() => []));
        } else {
            try {
                answer = { result: await this.#handleCommand(obj.command, obj.message) };
            } catch (error) {
                answer = { error: errorText(error) };
            }
        }
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
    }

    /**
     * Execute a command of the sendTo API
     *
     * @param command name of the command
     * @param message parameters of the command
     */
    async #handleCommand(command: string, message: unknown): Promise<unknown> {
        switch (command) {
            case 'listModels':
                return this.#refreshModels();

            case 'pull':
                this.#startPull(getModel(message));
                return { started: true };

            case 'deleteModel': {
                const model = getModel(message);
                await this.#requireClient().deleteModel(model);
                this.log.info(`Model ${model} deleted`);
                await this.#refreshModels();
                return { deleted: true };
            }

            case 'loadModel':
                await this.#setLoaded(getModel(message), true);
                return { loaded: true };

            case 'unloadModel':
                await this.#setLoaded(getModel(message), false);
                return { unloaded: true };

            default:
                throw new Error(`Unknown command "${command}"`);
        }
    }

    /** The URL of the Ollama API without trailing slash, or null if the configured URL is invalid */
    #getBaseUrl(): string | null {
        if (this.config.backend === 'external') {
            const url = (this.config.externalUrl || '').trim().replace(/\/+$/, '');
            try {
                const parsed = new URL(url);
                return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
            } catch {
                return null;
            }
        }
        // Docker publishes the port on the bind address only. 0.0.0.0 includes the loopback address.
        const host = this.config.bind && this.config.bind !== '0.0.0.0' ? this.config.bind : '127.0.0.1';
        return `http://${host}:${Number(this.config.port) || 11434}`;
    }

    /** Check that plugin-docker can run the container. Returns the error text, or null if everything is fine */
    async #checkDocker(): Promise<string | null> {
        if (!this.config.dockerCpu && !this.config.dockerRocm) {
            return 'Backend "docker" is selected, but no Docker service is enabled. Please open the instance settings and save them again.';
        }
        const plugin = this.getPluginInstance('docker') as unknown as DockerPlugin | null;
        const manager = plugin?.getDockerManager?.();
        if (!manager) {
            return 'The Docker plugin is not active, so the Ollama container cannot be started. Select the backend "External Ollama server" in the instance settings to use an existing server.';
        }
        const info = await manager.getDockerDaemonInfo().catch(() => null);
        if (!info?.daemonRunning) {
            return 'Docker is not available on this host. Install Docker Engine 20.10 or newer and add the user "iobroker" to the group "docker", or select the backend "External Ollama server" in the instance settings.';
        }
        this.log.debug(`Docker ${info.version || ''} is available`);
        return null;
    }

    /**
     * Ask /api/version until Ollama answers. On the first start the container may need a while
     * until it listens, and an external server may be down. There is no upper limit.
     */
    #waitForOllama(): void {
        const started = Date.now();
        let delay = RETRY_MIN_MS;
        let infoLogged = false;
        const attempt = async (): Promise<void> => {
            this.#retryTimer = undefined;
            if (this.#unloading || !this.#client) {
                return;
            }
            let version: string;
            try {
                version = await this.#client.getVersion(PROBE_TIMEOUT_MS);
            } catch (error) {
                if (this.#unloading) {
                    return;
                }
                if (!infoLogged && Date.now() - started >= WAIT_INFO_AFTER_MS) {
                    infoLogged = true;
                    this.log.info(
                        this.config.backend === 'docker'
                            ? `Ollama does not answer yet (${errorText(error)}). The container may still be starting, the adapter keeps trying.`
                            : `The external Ollama server does not answer yet (${errorText(error)}). The adapter keeps trying.`,
                    );
                } else {
                    this.log.debug(`Ollama does not answer yet: ${errorText(error)}`);
                }
                this.#retryTimer = this.setTimeout(() => void attempt(), delay);
                delay = Math.min(delay * 2, RETRY_MAX_MS);
                return;
            }
            await this.#onConnected(version);
        };
        void attempt();
    }

    async #onConnected(version: string): Promise<void> {
        this.#connected = true;
        await this.setState('info.backendVersion', version, true);
        await this.setState('info.connection', true, true);
        await this.#setStatus('ready');
        this.log.info(`Connected to Ollama ${version} at ${this.#client?.baseUrl}`);

        let models: ModelInfo[] | null = null;
        try {
            models = await this.#refreshModels();
        } catch (error) {
            await this.#reportError(`Cannot read the models: ${errorText(error)}`);
        }
        if (!this.#subscribed) {
            this.#subscribed = true;
            await this.subscribeStatesAsync('control.pull');
            await this.subscribeStatesAsync('control.refresh');
            await this.subscribeStatesAsync('models.*.load');
            await this.subscribeStatesAsync('models.*.unload');
        }
        this.#monitorTimer = this.setInterval(() => void this.#monitor(), MONITOR_INTERVAL_MS);
        if (models) {
            this.#ensureDefaultModel(models);
        }
    }

    /** Check the connection and update `loaded` regularly. If Ollama does not answer, wait for it again */
    async #monitor(): Promise<void> {
        if (this.#monitorRunning || !this.#client || !this.#connected) {
            return;
        }
        this.#monitorRunning = true;
        try {
            let running: OllamaRunningModel[];
            try {
                running = await this.#client.listRunningModels(PROBE_TIMEOUT_MS);
            } catch (error) {
                if (!this.#unloading) {
                    await this.#onDisconnected(error);
                }
                return;
            }
            await this.#updateLoaded(running);
        } catch (error) {
            this.log.warn(`Cannot update the models: ${errorText(error)}`);
        } finally {
            this.#monitorRunning = false;
        }
    }

    async #onDisconnected(error: unknown): Promise<void> {
        this.#stopMonitor();
        this.#connected = false;
        await this.setState('info.connection', false, true);
        await this.#setError(`Connection to Ollama lost: ${errorText(error)}`, 'warn');
        this.#waitForOllama();
    }

    #stopMonitor(): void {
        if (this.#monitorTimer) {
            this.clearInterval(this.#monitorTimer);
            this.#monitorTimer = undefined;
        }
    }

    /** The client, if Ollama is reachable. Commands fail with a clear message otherwise */
    #requireClient(): OllamaClient {
        if (!this.#client) {
            throw new Error('Ollama is not available, see info.lastError');
        }
        if (!this.#connected) {
            throw new Error(`Ollama does not answer at ${this.#client.baseUrl}`);
        }
        return this.#client;
    }

    /** Read the models from Ollama and bring the objects below `models` up to date */
    #refreshModels(): Promise<ModelInfo[]> {
        const run = this.#refreshQueue.then(() => this.#syncModels());
        this.#refreshQueue = run.catch(() => undefined);
        return run;
    }

    async #syncModels(): Promise<ModelInfo[]> {
        const client = this.#requireClient();
        const [models, running] = await Promise.all([client.listModels(), client.listRunningModels()]);
        const infos = toModelInfos(models, running);
        const current = new Map<string, string>();
        for (const info of infos) {
            const id = toModelId(info.name, this.FORBIDDEN_CHARS);
            const other = current.get(id);
            if (other) {
                this.log.warn(
                    `The models ${other} and ${info.name} get the same object ID "${id}", only ${other} is shown`,
                );
                continue;
            }
            current.set(id, info.name);
            if (this.#models.get(id) !== info.name) {
                await this.extendObject(`models.${id}`, { type: 'channel', common: { name: info.name }, native: {} });
                for (const [key, common] of Object.entries(MODEL_STATES)) {
                    await this.extendObject(`models.${id}.${key}`, { type: 'state', common, native: {} });
                }
            }
            for (const [key, value] of Object.entries(info)) {
                await this.setStateChangedAsync(`models.${id}.${key}`, value as ioBroker.StateValue, true);
            }
        }

        // Also models deleted while the adapter was not running
        const prefix = `${this.namespace}.models.`;
        const channels = await this.getObjectViewAsync('system', 'channel', {
            startkey: prefix,
            endkey: `${prefix}香`,
        });
        for (const row of channels.rows) {
            const id = row.id.substring(prefix.length);
            if (!id.includes('.') && !current.has(id)) {
                this.log.debug(`Model ${id} does not exist any more, deleting its objects`);
                await this.delObjectAsync(`models.${id}`, { recursive: true });
            }
        }
        this.#models = current;
        return infos;
    }

    /**
     * Update `loaded` of all models. A loaded model that is not known yet was downloaded without the adapter,
     * then the whole list is read again.
     *
     * @param running the answer of /api/ps
     */
    async #updateLoaded(running: OllamaRunningModel[]): Promise<void> {
        const known = [...this.#models.values()];
        if (running.some(item => !known.some(name => sameModel(name, item.name || item.model)))) {
            await this.#refreshModels();
            return;
        }
        for (const [id, name] of this.#models) {
            const loaded = running.some(item => sameModel(item.name || item.model, name));
            await this.setStateChangedAsync(`models.${id}.loaded`, loaded, true);
        }
    }

    /**
     * Load a model into memory or unload it
     *
     * @param model name of the model
     * @param load true to load, false to unload
     */
    async #setLoaded(model: string, load: boolean): Promise<void> {
        const client = this.#requireClient();
        if (load) {
            await client.loadModel(model, this.config.keepAlive);
        } else {
            await client.unloadModel(model);
        }
        this.log.info(`Model ${model} ${load ? 'loaded' : 'unloaded'}`);
        await this.#updateLoaded(await client.listRunningModels());
    }

    /**
     * Download the default model if Ollama does not have it, e.g. on the first start
     *
     * @param models the downloaded models
     */
    #ensureDefaultModel(models: ModelInfo[]): void {
        const model = (this.config.defaultModel || '').trim();
        if (!model || this.#pulling || models.some(item => sameModel(item.name, model))) {
            return;
        }
        this.log.info(`The default model ${model} is not downloaded yet, downloading it now`);
        try {
            this.#startPull(model);
        } catch (error) {
            void this.#reportError(`Cannot download the default model: ${errorText(error)}`);
        }
    }

    /**
     * Start the download of a model. Its progress goes to `control.pullProgress`, the result to the log
     *
     * @param model name of the model
     */
    #startPull(model: string): void {
        const client = this.#requireClient();
        if (!isValidModelName(model)) {
            throw new Error(`Invalid model name: ${JSON.stringify(model)}`);
        }
        if (this.#pulling) {
            throw new Error(`The download of ${this.#pulling} is still running`);
        }
        this.#pulling = model;
        void this.#pull(client, model);
    }

    async #pull(client: OllamaClient, model: string): Promise<void> {
        let lastWrite = 0;
        let lastPercent = 0;
        const writeProgress = (percent: number): void => {
            this.setState('control.pullProgress', percent, true).catch(error =>
                this.log.debug(`Cannot write the progress: ${errorText(error)}`),
            );
        };
        try {
            await this.setState('control.pull', model, true);
            await this.setState('control.pullProgress', 0, true);
            this.log.info(`Downloading model ${model}`);
            await client.pull(model, (_status, percent) => {
                const now = Date.now();
                if (percent === null || percent === lastPercent || now - lastWrite < PULL_PROGRESS_INTERVAL_MS) {
                    return;
                }
                lastWrite = now;
                lastPercent = percent;
                writeProgress(percent);
            });
            await this.setState('control.pullProgress', 100, true);
            this.log.info(`Model ${model} downloaded`);
        } catch (error) {
            if (!this.#unloading) {
                await this.setState('control.pullProgress', 0, true);
                await this.#reportError(`Cannot download model ${model}: ${errorText(error)}`);
            }
            return;
        } finally {
            this.#pulling = null;
        }
        await this.#refreshModels().catch(error => this.#reportError(`Cannot read the models: ${errorText(error)}`));
    }

    async #setStatus(status: Status): Promise<void> {
        await this.setState('info.status', status, true);
    }

    /**
     * Ollama cannot be used: log the reason and set the status to `error`
     *
     * @param message the reason
     * @param level log level
     */
    async #setError(message: string, level: 'error' | 'warn' = 'error'): Promise<void> {
        this.log[level](message);
        await this.setState('info.lastError', message, true);
        await this.#setStatus('error');
    }

    /**
     * A single command failed, Ollama itself still works: log the reason, the status stays
     *
     * @param message the reason
     */
    async #reportError(message: string): Promise<void> {
        this.log.error(message);
        await this.setState('info.lastError', message, true);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new AiServer(options);
} else {
    // otherwise start the instance directly
    (() => new AiServer())();
}
