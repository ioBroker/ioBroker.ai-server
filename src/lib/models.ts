/**
 * Models: comparison of names, the model list as the adapter reports it, and the choice of models
 * offered in the instance settings.
 */
import type { OllamaModel, OllamaRunningModel } from './ollama-client';

/** A model as the adapter reports it in its states and in `sendTo('listModels')` */
export interface ModelInfo {
    /** Name with tag, e.g. `qwen3:8b` */
    name: string;
    /** Size on disk in bytes */
    size: number;
    /** Number of parameters, e.g. `8.2B` */
    parameterSize: string;
    /** Quantization, e.g. `Q4_K_M` */
    quantization: string;
    /** Loaded into memory */
    loaded: boolean;
}

/** An option of the `autocompleteSendTo` control in the instance settings */
export interface ModelOption {
    /** The model name, saved in the configuration */
    value: string;
    /** Name and size, e.g. `✓ qwen3:4b (2.5 GB)` */
    label: string;
    /** The label is not a key of the translations */
    noTranslation: true;
}

/**
 * Models offered in the instance settings, from small to large. All of them can call tools.
 * Sizes are the download sizes in the Ollama registry (November 2026); they change only when the model is updated.
 */
export const RECOMMENDED_MODELS: readonly { name: string; size: number }[] = [
    { name: 'qwen3:1.7b', size: 1_359_293_444 },
    { name: 'llama3.2:3b', size: 2_019_393_189 },
    { name: 'qwen3:4b', size: 2_497_293_931 },
    { name: 'qwen3.5:4b', size: 3_324_173_934 },
    { name: 'qwen3:8b', size: 5_225_388_164 },
    { name: 'qwen3.5:9b', size: 6_550_825_550 },
    { name: 'gemma4:e4b', size: 6_583_656_505 },
    { name: 'gpt-oss:20b', size: 13_793_441_566 },
];

/**
 * Bring a model name into the form Ollama lists it in: `qwen3` and `library/qwen3:latest` are both `qwen3:latest`
 *
 * @param name model name as entered or reported
 */
export function normalizeModelName(name: string): string {
    let result = name.trim().toLowerCase();
    result = result.replace(/^registry\.ollama\.ai\//, '').replace(/^library\//, '');
    // the tag follows the last ":" after the last "/", a host may have a port before it
    const lastPart = result.substring(result.lastIndexOf('/') + 1);
    return lastPart.includes(':') ? result : `${result}:latest`;
}

/**
 * Whether two names denote the same model
 *
 * @param a first name
 * @param b second name
 */
export function sameModel(a: string, b: string): boolean {
    return normalizeModelName(a) === normalizeModelName(b);
}

/**
 * Combine the answers of `/api/tags` and `/api/ps`
 *
 * @param models the downloaded models
 * @param running the models loaded into memory
 */
export function toModelInfos(models: OllamaModel[], running: OllamaRunningModel[]): ModelInfo[] {
    return models.map(model => ({
        name: model.name,
        size: model.size,
        parameterSize: model.details?.parameter_size ?? '',
        quantization: model.details?.quantization_level ?? '',
        loaded: running.some(item => sameModel(item.name || item.model, model.name)),
    }));
}

/**
 * Size for humans, as Ollama shows it: decimal units
 *
 * @param bytes size in bytes
 */
export function formatSize(bytes: number): string {
    if (bytes >= 1e9) {
        return `${(bytes / 1e9).toFixed(1)} GB`;
    }
    return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * The choice of the default model in the instance settings: the downloaded models, marked with ✓,
 * then the recommended ones that are not downloaded yet.
 *
 * @param installed the downloaded models, empty if Ollama is not reachable
 */
export function modelOptions(installed: readonly Pick<ModelInfo, 'name' | 'size'>[]): ModelOption[] {
    const options: ModelOption[] = [...installed]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(model => ({
            value: model.name,
            label: `✓ ${model.name} (${formatSize(model.size)})`,
            noTranslation: true,
        }));
    for (const model of RECOMMENDED_MODELS) {
        if (!installed.some(item => sameModel(item.name, model.name))) {
            options.push({
                value: model.name,
                label: `${model.name} (${formatSize(model.size)})`,
                noTranslation: true,
            });
        }
    }
    return options;
}
