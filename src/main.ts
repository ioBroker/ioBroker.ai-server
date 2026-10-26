/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';
import { OllamaClient } from './lib/ollama-client';

/** First and maximal delay between two attempts to reach Ollama */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;
/** After this time without answer, the log explains why the adapter is still waiting */
const WAIT_INFO_AFTER_MS = 60_000;
/** Interval of the connection check via /api/ps */
const MONITOR_INTERVAL_MS = 30_000;
/** Timeout of the short requests that only check whether Ollama answers */
const PROBE_TIMEOUT_MS = 5_000;

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

class AiServer extends utils.Adapter {
    #client: OllamaClient | null = null;
    #connected = false;
    #unloading = false;
    #retryTimer: ioBroker.Timeout | undefined;
    #monitorTimer: ioBroker.Interval | undefined;
    #monitorRunning = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'ai-server',
        });
        this.on('ready', this.onReady.bind(this));
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
        this.#monitorTimer = this.setInterval(() => void this.#monitor(), MONITOR_INTERVAL_MS);
    }

    /** Check the connection regularly. If Ollama does not answer, wait for it again */
    async #monitor(): Promise<void> {
        if (this.#monitorRunning || !this.#client || !this.#connected) {
            return;
        }
        this.#monitorRunning = true;
        try {
            await this.#client.listRunningModels(PROBE_TIMEOUT_MS);
        } catch (error) {
            if (!this.#unloading) {
                await this.#onDisconnected(error);
            }
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

    async #setStatus(status: Status): Promise<void> {
        await this.setState('info.status', status, true);
    }

    async #setError(message: string, level: 'error' | 'warn' = 'error'): Promise<void> {
        this.log[level](message);
        await this.setState('info.lastError', message, true);
        await this.#setStatus('error');
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new AiServer(options);
} else {
    // otherwise start the instance directly
    (() => new AiServer())();
}
