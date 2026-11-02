/**
 * Objects of the models: IDs and definitions of the states below `models.<id>`.
 * The static objects (`info.*`, `control.*`) are defined in io-package.json.
 */
import type { ModelInfo } from './models';

/** The buttons of a model */
export type ModelCommand = 'load' | 'unload';

/**
 * Object ID of a model: `qwen3:8b` becomes `qwen3_8b`. The original name stays in `common.name`
 * of the channel and in the state `name`.
 *
 * @param name model name
 * @param forbiddenChars `adapter.FORBIDDEN_CHARS`
 */
export function toModelId(name: string, forbiddenChars: RegExp): string {
    return name.replace(forbiddenChars, '_').replace(/[.:/]/g, '_');
}

/** Definitions of the states of a model, by the last part of their ID. The values come from {@link ModelInfo} */
export const MODEL_STATES: Readonly<Record<keyof ModelInfo | ModelCommand, ioBroker.StateCommon>> = {
    name: { name: 'Name of the model', type: 'string', role: 'text', read: true, write: false },
    size: { name: 'Size on disk', type: 'number', role: 'value', unit: 'B', read: true, write: false },
    parameterSize: { name: 'Number of parameters', type: 'string', role: 'text', read: true, write: false },
    quantization: { name: 'Quantization', type: 'string', role: 'text', read: true, write: false },
    loaded: { name: 'Loaded into memory', type: 'boolean', role: 'indicator', read: true, write: false },
    load: { name: 'Load the model into memory', type: 'boolean', role: 'button', read: false, write: true },
    unload: { name: 'Unload the model from memory', type: 'boolean', role: 'button', read: false, write: true },
};

/**
 * Recognize a button of a model
 *
 * @param localId state ID without the namespace, e.g. `models.qwen3_8b.load`
 * @returns the model ID and the command, or null for any other state
 */
export function parseModelCommand(localId: string): { id: string; command: ModelCommand } | null {
    const match = /^models\.([^.]+)\.(load|unload)$/.exec(localId);
    return match ? { id: match[1], command: match[2] as ModelCommand } : null;
}
