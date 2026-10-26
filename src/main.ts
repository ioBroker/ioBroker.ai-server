/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';

class AiServer extends utils.Adapter {
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
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);

        if (this.config.backend === 'docker') {
            const service = this.config.dockerRocm ? 'ollama-rocm' : this.config.dockerCpu ? 'ollama' : '';
            if (service) {
                this.log.info(
                    `Ollama runs in the Docker service "${service}" on ${this.config.bind}:${this.config.port}`,
                );
            } else {
                this.log.warn(
                    'Backend "docker" is selected, but no Docker service is enabled. Please save the configuration again.',
                );
            }
        } else {
            this.log.info(`Using the external Ollama server ${this.config.externalUrl}`);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            void this.setState('info.connection', false, true);
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new AiServer(options);
} else {
    // otherwise start the instance directly
    (() => new AiServer())();
}
