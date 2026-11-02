/**
 * Requests to the model: check the messages of `sendTo('chat')` and `sendTo('generate')`, build the requests to
 * Ollama and the metrics of the answers.
 */
import {
    type OllamaChatRequest,
    type OllamaGenerateRequest,
    type OllamaMessage,
    type OllamaStats,
    toKeepAlive,
} from './ollama-client';

/** What the configuration adds to every request */
export interface RequestDefaults {
    /** Model used if the message does not name one */
    model: string;
    /** How long the model stays loaded after the request, e.g. "5m" */
    keepAlive: string | number;
}

/** Metrics of an answer, as written into the states `metrics.*` */
export interface RequestMetrics {
    /** Duration of the request to Ollama in milliseconds, without the time in the queue */
    durationMs: number;
    /** Number of tokens in the prompt */
    promptTokens: number;
    /** Number of tokens in the answer */
    completionTokens: number;
    /** Speed of the answer, from `eval_count / eval_duration` */
    tokensPerSecond: number;
}

const ROLES: readonly string[] = ['system', 'user', 'assistant', 'tool'];

function asObject(message: unknown): Record<string, unknown> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new Error('The message has to be an object');
    }
    return message as Record<string, unknown>;
}

function pickModel(model: unknown, defaults: RequestDefaults): string {
    const name = typeof model === 'string' && model.trim() ? model.trim() : (defaults.model || '').trim();
    if (!name) {
        throw new Error('No model given and no default model set in the instance settings');
    }
    return name;
}

function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`"${name}" has to be a text`);
    }
    return value;
}

/**
 * Parameters that are passed to Ollama unchanged if they are given
 *
 * @param input the message of sendTo
 */
function passThrough(input: Record<string, unknown>): Pick<OllamaChatRequest, 'format' | 'options' | 'think'> {
    const result: Pick<OllamaChatRequest, 'format' | 'options' | 'think'> = {};
    if (input.format !== undefined) {
        result.format = input.format;
    }
    if (input.options !== undefined) {
        result.options = input.options as Record<string, unknown>;
    }
    if (input.think !== undefined) {
        result.think = input.think as boolean | string;
    }
    return result;
}

/**
 * Build the request to `POST /api/chat` from the message of `sendTo('chat')`
 *
 * @param message `{ model?, messages, system?, options?, format?, tools?, think? }`
 * @param defaults default model and keep-alive from the configuration
 */
export function toChatRequest(message: unknown, defaults: RequestDefaults): OllamaChatRequest {
    const input = asObject(message);
    if (!Array.isArray(input.messages) || !input.messages.length) {
        throw new Error('"messages" has to be a non-empty list, e.g. [{ "role": "user", "content": "Hello" }]');
    }
    input.messages.forEach((item: unknown, index: number) => {
        const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
        if (!entry || typeof entry.role !== 'string' || !ROLES.includes(entry.role)) {
            throw new Error(`messages[${index}]: "role" has to be one of ${ROLES.join(', ')}`);
        }
        if (typeof entry.content !== 'string') {
            throw new Error(`messages[${index}]: "content" has to be a text`);
        }
        if (
            entry.images !== undefined &&
            (!Array.isArray(entry.images) || entry.images.some(image => typeof image !== 'string'))
        ) {
            throw new Error(`messages[${index}]: "images" has to be a list of base64 texts`);
        }
    });
    const system = optionalString(input.system, 'system');
    // further fields of the messages, e.g. the tool calls of the model, are passed on unchanged
    const messages = input.messages as OllamaMessage[];
    const request: OllamaChatRequest = {
        model: pickModel(input.model, defaults),
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        keep_alive: toKeepAlive(defaults.keepAlive),
        ...passThrough(input),
    };
    if (input.tools !== undefined) {
        request.tools = input.tools as unknown[];
    }
    return request;
}

/**
 * Build the request to `POST /api/generate` from the message of `sendTo('generate')`
 *
 * @param message `{ model?, prompt, system?, options?, format?, think? }`
 * @param defaults default model and keep-alive from the configuration
 */
export function toGenerateRequest(message: unknown, defaults: RequestDefaults): OllamaGenerateRequest {
    const input = asObject(message);
    const prompt = optionalString(input.prompt, 'prompt');
    if (!prompt) {
        throw new Error('"prompt" has to be a non-empty text');
    }
    const request: OllamaGenerateRequest = {
        model: pickModel(input.model, defaults),
        prompt,
        keep_alive: toKeepAlive(defaults.keepAlive),
        ...passThrough(input),
    };
    const system = optionalString(input.system, 'system');
    if (system) {
        request.system = system;
    }
    return request;
}

/**
 * Metrics of an answer
 *
 * @param stats the statistics Ollama sends with the answer
 * @param durationMs measured duration of the request
 */
export function toMetrics(stats: OllamaStats, durationMs: number): RequestMetrics {
    const completionTokens = stats.eval_count ?? 0;
    const evalSeconds = (stats.eval_duration ?? 0) / 1e9;
    return {
        durationMs,
        promptTokens: stats.prompt_eval_count ?? 0,
        completionTokens,
        tokensPerSecond: evalSeconds > 0 ? Math.round((completionTokens / evalSeconds) * 10) / 10 : 0,
    };
}

/**
 * Shorten a prompt or an answer for the debug log
 *
 * @param text the text
 * @param max maximal length
 */
export function shorten(text: string, max = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
