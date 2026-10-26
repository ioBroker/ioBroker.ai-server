// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** Run Ollama in a container managed by plugin-docker, or use an existing server */
            backend: 'docker' | 'external';
            /** Hardware used by the container */
            gpu: 'cpu' | 'rocm';
            /** Derived: backend === 'docker' && gpu === 'cpu'. Enables the CPU service in docker-compose.yaml */
            dockerCpu: boolean;
            /** Derived: backend === 'docker' && gpu === 'rocm'. Enables the ROCm service in docker-compose.yaml */
            dockerRocm: boolean;
            /** URL of the external Ollama server, e.g. http://192.168.1.50:11434 */
            externalUrl: string;
            /** Host address the container port is bound to */
            bind: string;
            /** Host port of the container */
            port: number;
            /** How long a model stays loaded, e.g. "5m", "1h", "0" or "-1" */
            keepAlive: string;
            /** Maximal number of parallel requests to Ollama */
            parallel: number;
            /** Maximal number of waiting requests */
            maxQueue: number;
            /** Timeout of a single request in seconds */
            requestTimeout: number;
            /** Model used if a request does not name one */
            defaultModel: string;
            /** Let plugin-docker update the image automatically */
            autoUpdate: boolean;
            /** Stop the container when the instance stops */
            stopOnUnload: boolean;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
