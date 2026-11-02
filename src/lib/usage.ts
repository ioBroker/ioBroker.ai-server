/**
 * Use of the models: when a model was used the last time, and which models may be deleted automatically
 * because nobody used them for a while.
 */
import { sameModel } from './models';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `lastUsed` of a model that stays loaded is written at most this often */
export const LAST_USED_RESOLUTION_MS = 10 * 60 * 1000;

/** A model as seen by the automatic deletion */
export interface ModelUsage {
    /** Name with tag, e.g. `qwen3:8b` */
    name: string;
    /** Loaded into memory right now */
    loaded: boolean;
    /** Time of the last use in ms, undefined if not known yet */
    lastUsed: number | undefined;
}

/**
 * Number of whole days since the last use
 *
 * @param lastUsed time of the last use in ms
 * @param now current time in ms
 */
export function daysSince(lastUsed: number, now: number): number {
    return Math.max(0, Math.floor((now - lastUsed) / DAY_MS));
}

/**
 * The models that were not used for `days` days. A loaded model counts as used, a model without known last use
 * is kept: its time is counted from the moment the adapter saw it first.
 *
 * @param models the downloaded models
 * @param now current time in ms
 * @param days unused this many days, 0 = never delete
 * @param keep names of models that are never deleted, e.g. the default model
 */
export function findUnusedModels(models: ModelUsage[], now: number, days: number, keep: string[]): string[] {
    if (!(days > 0)) {
        return [];
    }
    return models
        .filter(
            model =>
                !model.loaded &&
                model.lastUsed !== undefined &&
                now - model.lastUsed >= days * DAY_MS &&
                !keep.some(name => name && sameModel(name, model.name)),
        )
        .map(model => model.name);
}
