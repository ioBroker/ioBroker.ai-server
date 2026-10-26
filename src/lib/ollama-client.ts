/**
 * HTTP client for the Ollama API (https://docs.ollama.com/api).
 *
 * Uses the native fetch of Node.js. Every request gets its own AbortController: it ends after
 * its timeout, and all running requests can be aborted at once when the adapter unloads.
 */

/** Allowed characters of a model name, e.g. `qwen3:8b` or `library/llama3.2:latest` */
export const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

/**
 * Check a model name before it is sent to Ollama
 *
 * @param name the model name to check
 */
export function isValidModelName(name: unknown): name is string {
    return typeof name === 'string' && MODEL_NAME_PATTERN.test(name);
}

/**
 * Convert the configured keep-alive value into the form Ollama accepts in a request.
 * Ollama takes a number as seconds and a string as duration ("5m"). A plain number in a
 * string ("-1", "300") is rejected as a duration without unit, so it is sent as number.
 *
 * @param value the value from the configuration, e.g. "5m", "0" or "-1"
 */
export function toKeepAlive(value: string | number): string | number {
    const text = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(text)) {
        return Number(text);
    }
    return text || '5m';
}

/** Details of a model as reported by `GET /api/tags` and `GET /api/ps` */
export interface OllamaModelDetails {
    /** Model this one was derived from */
    parent_model?: string;
    /** File format, e.g. `gguf` */
    format?: string;
    /** Model family, e.g. `qwen3` */
    family?: string;
    /** All families of the model */
    families?: string[] | null;
    /** Number of parameters, e.g. `8.2B` */
    parameter_size?: string;
    /** Quantization, e.g. `Q4_K_M` */
    quantization_level?: string;
}

/** One entry of `GET /api/tags` */
export interface OllamaModel {
    /** Name with tag, e.g. `qwen3:8b` */
    name: string;
    /** Same as name */
    model: string;
    /** Time of the last change as ISO string */
    modified_at?: string;
    /** Size on disk in bytes */
    size: number;
    /** SHA-256 digest of the manifest */
    digest?: string;
    /** Details of the model */
    details?: OllamaModelDetails;
}

/** One entry of `GET /api/ps` */
export interface OllamaRunningModel extends OllamaModel {
    /** Time when the model will be unloaded as ISO string */
    expires_at?: string;
    /** Part of the model in the memory of the GPU in bytes */
    size_vram?: number;
}

/** One line of the NDJSON stream of `POST /api/pull` */
export interface OllamaPullStatus {
    /** e.g. `pulling manifest`, `pulling <digest>`, `success` */
    status?: string;
    /** Layer the message is about */
    digest?: string;
    /** Size of the layer in bytes */
    total?: number;
    /** Downloaded bytes of the layer */
    completed?: number;
    /** Error text, the pull failed */
    error?: string;
}

/** One message of a chat */
export interface OllamaMessage {
    /** Author of the message */
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** Text of the message */
    content: string;
    /** Base64-encoded images for multimodal models */
    images?: string[];
    /** Thinking process of a thinking model */
    thinking?: string;
    /** Tools the model wants to call. The adapter does not execute them */
    tool_calls?: unknown[];
    /** Name of the executed tool, for messages with role `tool` */
    tool_name?: string;
}

/** Statistics of a chat or generate answer. All durations are in nanoseconds */
export interface OllamaStats {
    /** Time spent for the whole request */
    total_duration?: number;
    /** Time spent to load the model */
    load_duration?: number;
    /** Number of tokens in the prompt */
    prompt_eval_count?: number;
    /** Time spent to evaluate the prompt */
    prompt_eval_duration?: number;
    /** Number of tokens in the answer */
    eval_count?: number;
    /** Time spent to generate the answer */
    eval_duration?: number;
}

/** Request of `POST /api/chat`, passed to Ollama unchanged */
export interface OllamaChatRequest {
    /** Name of the model */
    model: string;
    /** Chat history including the new message */
    messages: OllamaMessage[];
    /** Tool definitions in JSON */
    tools?: unknown[];
    /** `json` or a JSON schema */
    format?: unknown;
    /** Model parameters, e.g. `temperature` */
    options?: Record<string, unknown>;
    /** How long the model stays loaded after the request */
    keep_alive?: string | number;
    /** Let a thinking model think before answering */
    think?: boolean | string;
}

/** Answer of `POST /api/chat` without streaming */
export interface OllamaChatResponse extends OllamaStats {
    /** Name of the model */
    model: string;
    /** Time of the answer as ISO string */
    created_at?: string;
    /** The answer of the model */
    message: OllamaMessage;
    /** Always true without streaming */
    done: boolean;
    /** e.g. `stop` or `length` */
    done_reason?: string;
}

/** Request of `POST /api/generate`, passed to Ollama unchanged */
export interface OllamaGenerateRequest {
    /** Name of the model */
    model: string;
    /** The prompt. Without prompt, the model is only loaded */
    prompt?: string;
    /** System message, overrides the one of the model */
    system?: string;
    /** Base64-encoded images for multimodal models */
    images?: string[];
    /** `json` or a JSON schema */
    format?: unknown;
    /** Model parameters, e.g. `temperature` */
    options?: Record<string, unknown>;
    /** How long the model stays loaded after the request */
    keep_alive?: string | number;
    /** Let a thinking model think before answering */
    think?: boolean | string;
}

/** Answer of `POST /api/generate` without streaming */
export interface OllamaGenerateResponse extends OllamaStats {
    /** Name of the model */
    model: string;
    /** Time of the answer as ISO string */
    created_at?: string;
    /** The answer of the model */
    response: string;
    /** Always true without streaming */
    done: boolean;
    /** e.g. `stop`, `length` or `unload` */
    done_reason?: string;
}

/** Timer functions, so that the adapter can pass its own timers, which are cleared on unload */
export interface Timers {
    /** Like the global setTimeout */
    setTimeout(callback: () => void, ms: number): unknown;
    /** Like the global clearTimeout */
    clearTimeout(handle: unknown): void;
}

/** Options of the OllamaClient */
export interface OllamaClientOptions {
    /** e.g. http://127.0.0.1:11434, a trailing slash is removed */
    baseUrl: string;
    /** Timeout of a request in milliseconds. For a pull, it is the maximal silence between two messages */
    timeoutMs: number;
    /** Replaces the global fetch, used by the tests */
    fetch?: typeof fetch;
    /** Replaces the global timers */
    timers?: Timers;
}

/** Error of a request to Ollama, with the error text of Ollama if it answered */
export class OllamaError extends Error {
    /** HTTP status of the answer, if Ollama answered at all */
    readonly status?: number;

    /**
     * @param message error text
     * @param status HTTP status of the answer
     */
    constructor(message: string, status?: number) {
        super(message);
        this.name = 'OllamaError';
        this.status = status;
    }
}

/** Splits a stream of text into newline-delimited JSON objects */
export class NdjsonParser {
    #buffer = '';

    /**
     * Add a chunk of the stream
     *
     * @param chunk text as received, may end in the middle of a line
     * @returns all objects whose line is complete
     */
    push(chunk: string): unknown[] {
        this.#buffer += chunk;
        const lines = this.#buffer.split('\n');
        this.#buffer = lines.pop() ?? '';
        return NdjsonParser.#parse(lines);
    }

    /** Return the last object, if the stream did not end with a line break */
    flush(): unknown[] {
        const rest = this.#buffer;
        this.#buffer = '';
        return NdjsonParser.#parse([rest]);
    }

    static #parse(lines: string[]): unknown[] {
        const result: unknown[] = [];
        for (const line of lines) {
            const text = line.trim();
            if (!text) {
                continue;
            }
            try {
                result.push(JSON.parse(text));
            } catch {
                throw new OllamaError(`Invalid line in the answer of Ollama: ${text.slice(0, 100)}`);
            }
        }
        return result;
    }
}

/**
 * Calculates the progress of a pull in percent over all layers seen so far.
 * Ollama reports `completed` / `total` per layer (digest), so a single message would jump
 * back to 0 % with every new layer.
 */
export class PullProgress {
    readonly #layers = new Map<string, { total: number; completed: number }>();

    /**
     * Take the next status message into account
     *
     * @param status one line of the pull stream
     * @returns progress from 0 to 100, or null if the message says nothing about the progress
     */
    update(status: OllamaPullStatus): number | null {
        if (status.status === 'success') {
            return 100;
        }
        if (!status.digest || !status.total) {
            return null;
        }
        this.#layers.set(status.digest, {
            total: status.total,
            completed: Math.min(status.completed ?? 0, status.total),
        });
        let total = 0;
        let completed = 0;
        for (const layer of this.#layers.values()) {
            total += layer.total;
            completed += layer.completed;
        }
        // 100 % only when Ollama has verified and written the model and answered "success"
        return Math.min(99, Math.floor((completed / total) * 100));
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        // fetch reports network errors as "fetch failed" with the real reason in `cause`
        const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
        return cause?.code || cause?.message || error.message;
    }
    return String(error);
}

async function readError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    try {
        const json = JSON.parse(text) as { error?: string };
        if (json.error) {
            return json.error;
        }
    } catch {
        // not JSON, use the text itself
    }
    return text.trim() || `HTTP ${response.status} ${response.statusText}`.trim();
}

/** Client for the Ollama API */
export class OllamaClient {
    readonly baseUrl: string;
    readonly #timeoutMs: number;
    readonly #fetch: typeof fetch;
    readonly #timers: Timers;
    readonly #controllers = new Set<AbortController>();

    /** @param options base URL, timeout and optional replacements for fetch and the timers */
    constructor(options: OllamaClientOptions) {
        this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
        this.#timeoutMs = options.timeoutMs;
        this.#fetch = options.fetch ?? fetch;
        this.#timers = options.timers ?? {
            setTimeout: (callback, ms) => setTimeout(callback, ms),
            clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
        };
    }

    /**
     * `GET /api/version`
     *
     * @param timeoutMs overrides the default timeout, e.g. for a short availability check
     */
    async getVersion(timeoutMs?: number): Promise<string> {
        const answer = await this.#requestJson<{
            version?: string;
        }>('GET', '/api/version', undefined, timeoutMs);
        return answer.version ?? '';
    }

    /** `GET /api/tags`: the models available locally */
    async listModels(): Promise<OllamaModel[]> {
        const answer = await this.#requestJson<{
            models?: OllamaModel[];
        }>('GET', '/api/tags');
        return answer.models ?? [];
    }

    /**
     * `GET /api/ps`: the models loaded into memory
     *
     * @param timeoutMs overrides the default timeout
     */
    async listRunningModels(timeoutMs?: number): Promise<OllamaRunningModel[]> {
        const answer = await this.#requestJson<{
            models?: OllamaRunningModel[];
        }>('GET', '/api/ps', undefined, timeoutMs);
        return answer.models ?? [];
    }

    /**
     * `DELETE /api/delete`
     *
     * @param model name of the model
     */
    async deleteModel(model: string): Promise<void> {
        OllamaClient.#checkModel(model);
        await this.#requestJson('DELETE', '/api/delete', { model });
    }

    /**
     * Load a model into memory: `POST /api/generate` without a prompt
     *
     * @param model name of the model
     * @param keepAlive how long the model stays loaded, e.g. "5m" or -1
     */
    async loadModel(model: string, keepAlive: string | number): Promise<void> {
        OllamaClient.#checkModel(model);
        await this.#requestJson('POST', '/api/generate', { model, keep_alive: toKeepAlive(keepAlive) });
    }

    /**
     * Unload a model from memory: `POST /api/generate` with `keep_alive: 0`
     *
     * @param model name of the model
     */
    async unloadModel(model: string): Promise<void> {
        OllamaClient.#checkModel(model);
        await this.#requestJson('POST', '/api/generate', { model, keep_alive: 0 });
    }

    /**
     * `POST /api/chat` without streaming
     *
     * @param request model, messages and optional parameters, passed to Ollama unchanged
     */
    async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
        OllamaClient.#checkModel(request.model);
        return this.#requestJson<OllamaChatResponse>('POST', '/api/chat', { ...request, stream: false });
    }

    /**
     * `POST /api/generate` without streaming
     *
     * @param request model, prompt and optional parameters, passed to Ollama unchanged
     */
    async generate(request: OllamaGenerateRequest): Promise<OllamaGenerateResponse> {
        OllamaClient.#checkModel(request.model);
        return this.#requestJson<OllamaGenerateResponse>('POST', '/api/generate', { ...request, stream: false });
    }

    /**
     * `POST /api/pull` with streaming. A download of several GB takes longer than any sensible
     * request timeout, so here the timeout applies to the silence between two messages.
     *
     * @param model name of the model
     * @param onStatus called for every message with the overall progress (null if unknown)
     */
    async pull(model: string, onStatus?: (status: OllamaPullStatus, percent: number | null) => void): Promise<void> {
        OllamaClient.#checkModel(model);
        await this.#withAbort(this.#timeoutMs, async (signal, touch) => {
            const response = await this.#send('POST', '/api/pull', { model, stream: true }, signal);
            if (!response.body) {
                throw new OllamaError('Ollama sent an empty answer');
            }
            const parser = new NdjsonParser();
            const progress = new PullProgress();
            const decoder = new TextDecoder();
            let success = false;
            const handle = (items: unknown[]): void => {
                for (const item of items) {
                    const status = item as OllamaPullStatus;
                    if (status.error) {
                        throw new OllamaError(status.error);
                    }
                    if (status.status === 'success') {
                        success = true;
                    }
                    onStatus?.(status, progress.update(status));
                }
            };
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                touch();
                handle(parser.push(decoder.decode(value, { stream: true })));
            }
            handle(parser.push(decoder.decode()));
            handle(parser.flush());
            if (!success) {
                throw new OllamaError(`The download of ${model} ended without success`);
            }
        });
    }

    /** Abort all running requests, e.g. when the adapter unloads */
    abortAll(): void {
        for (const controller of this.#controllers) {
            controller.abort();
        }
        this.#controllers.clear();
    }

    static #checkModel(model: unknown): void {
        if (!isValidModelName(model)) {
            throw new OllamaError(`Invalid model name: ${JSON.stringify(model)}`);
        }
    }

    async #requestJson<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
        return this.#withAbort(timeoutMs ?? this.#timeoutMs, async signal => {
            const response = await this.#send(method, path, body, signal);
            const text = await response.text();
            if (!text) {
                return {} as T;
            }
            try {
                return JSON.parse(text) as T;
            } catch {
                throw new OllamaError(`Invalid answer of Ollama for ${path}: ${text.slice(0, 100)}`);
            }
        });
    }

    /**
     * Run a request with its own AbortController and timeout
     *
     * @param timeoutMs time until the request is aborted
     * @param task the request. It may call `touch()` to restart the timeout
     */
    async #withAbort<T>(timeoutMs: number, task: (signal: AbortSignal, touch: () => void) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        this.#controllers.add(controller);
        let timedOut = false;
        let timer: unknown;
        const touch = (): void => {
            this.#timers.clearTimeout(timer);
            timer = this.#timers.setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        };
        touch();
        try {
            return await task(controller.signal, touch);
        } catch (error) {
            const aborted = controller.signal.aborted;
            // Close the connection, e.g. a stream that delivered an error message
            controller.abort();
            if (timedOut) {
                throw new OllamaError(`Ollama did not answer within ${Math.round(timeoutMs / 1000)} s`);
            }
            if (aborted) {
                throw new OllamaError('The request to Ollama was aborted');
            }
            throw error;
        } finally {
            this.#timers.clearTimeout(timer);
            this.#controllers.delete(controller);
        }
    }

    async #send(method: string, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
        let response: Response;
        try {
            response = await this.#fetch(`${this.baseUrl}${path}`, {
                method,
                headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal,
            });
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            throw new OllamaError(`Cannot reach Ollama at ${this.baseUrl}: ${describeError(error)}`);
        }
        if (!response.ok) {
            throw new OllamaError(await readError(response), response.status);
        }
        return response;
    }
}
