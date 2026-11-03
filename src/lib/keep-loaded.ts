/**
 * Keeping the default model in memory (setting "Keep the default model loaded"). Ollama unloads a model when its
 * keep-alive ends, and every request sets a new one, also the requests of clients that use Ollama directly with its
 * default of 5 minutes. So the adapter checks regularly whether the model is still loaded and loaded for good.
 */
import { sameModel } from './models';
import type { OllamaRunningModel } from './ollama-client';

/** `keep_alive` of a model that is never unloaded */
export const KEEP_FOREVER = -1;

/** Ollama reports a model loaded with `keep_alive: -1` as unloaded in about 290 years. Anything after a year counts. */
const LOADED_FOR_GOOD_MS = 365 * 24 * 60 * 60_000;

/**
 * - `load`: the model is not loaded, and no other model is
 * - `pin`: the model is loaded, but Ollama will unload it some time
 * - `none`: nothing to do, or another model is loaded, which loading this one would push out of memory
 */
export type KeepLoadedAction = 'none' | 'load' | 'pin';

/**
 * What to do so that a model stays loaded
 *
 * @param model the model to keep loaded
 * @param running the answer of /api/ps
 * @param now the current time
 */
export function keepLoadedAction(
    model: string,
    running: readonly OllamaRunningModel[],
    now = Date.now(),
): KeepLoadedAction {
    const loaded = running.find(item => sameModel(item.name || item.model, model));
    if (!loaded) {
        return running.length ? 'none' : 'load';
    }
    const expires = loaded.expires_at ? Date.parse(loaded.expires_at) : NaN;
    // without a valid time, it cannot be told: better not to load it again every time
    return Number.isFinite(expires) && expires - now < LOADED_FOR_GOOD_MS ? 'pin' : 'none';
}

/**
 * `keep_alive` for a request to a model or for loading it
 *
 * @param model the model of the request
 * @param keepAlive the keep-alive of the settings
 * @param keptModel the model that stays loaded, empty if none
 */
export function keepAliveFor(model: string, keepAlive: string | number, keptModel: string): string | number {
    return keptModel && sameModel(model, keptModel) ? KEEP_FOREVER : keepAlive;
}
