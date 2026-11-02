/**
 * The models in the device manager of the admin: one card per model with its size and last use, buttons to load,
 * unload and delete it, and a download with progress. The work itself is done by the adapter, see {@link ModelBackend}.
 */
import { type AdapterInstance, I18n } from '@iobroker/adapter-core';
import {
    type ActionContext,
    type ConfigItemAny,
    type DeviceInfo,
    type DeviceLoadContext,
    DeviceManagement,
    type DeviceRefreshResponse,
    type InstanceDetails,
    type InstanceRefreshResponse,
} from '@iobroker/dm-utils';
import { formatSize, type ModelInfo, RECOMMENDED_MODELS, sameModel } from './models';
import { isValidModelName } from './ollama-client';
import { daysSince } from './usage';

/** The GUI asks for the next message of a running action and gives up after 5 s without answer */
const PROGRESS_INTERVAL_MS = 1_000;
/** A GUI that does not confirm a progress message within this time was closed: the download goes on without it */
const GUI_GONE_MS = 15_000;
/** Timeout of the GUI for actions that only take a moment */
const SHORT_ACTION_MS = 60_000;

/** What the device manager needs from the adapter */
export interface ModelBackend {
    /** Read the models from Ollama and bring their objects up to date. Fails if Ollama does not answer */
    listModels(): Promise<ModelInfo[]>;
    /** Full ID of the channel of a model, e.g. `ai-server.0.models.qwen3_8b`, undefined if the model is unknown */
    getChannelId(name: string): string | undefined;
    /** Time of the last use in ms, undefined if not known */
    getLastUsed(name: string): number | undefined;
    /** The settings that change what the cards show */
    getSettings(): { defaultModel: string; deleteUnusedDays: number; requestTimeoutMs: number };
    /** Load a model into memory or unload it */
    setLoaded(name: string, load: boolean): Promise<void>;
    /** Delete a model from the disk */
    deleteModel(name: string): Promise<void>;
    /** Download a model. Resolves when it is complete, fails if the download fails */
    pull(name: string, onProgress: (percent: number | null, status: string) => void): Promise<void>;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A text in all languages. The placeholders are replaced here: `I18n.getTranslatedObject()` of adapter-core 3.4.3
 * puts only the last argument into the first `%s`, and returns nothing for a text with `%s` but without arguments.
 * The argument `%s` keeps the text as it is.
 *
 * @param key key in admin/i18n
 * @param args values for the placeholders `%s`, in their order
 */
function tr(key: string, ...args: (string | number)[]): ioBroker.Translated {
    const texts: Record<string, string> = I18n.getTranslatedObject(key, '%s');
    return Object.fromEntries(
        Object.entries(texts).map(([lang, text]) => [
            lang,
            args.reduce<string>((result, arg) => result.replace('%s', String(arg)), text),
        ]),
    ) as ioBroker.Translated;
}

/**
 * When a model was used the last time, for humans
 *
 * @param days whole days since the last use
 */
function describeDays(days: number): ioBroker.Translated {
    if (days === 0) {
        return tr('dm_today');
    }
    return days === 1 ? tr('dm_yesterday') : tr('dm_daysAgo', days);
}

/** The models as devices of the device manager. The ID of a device is the name of the model. */
export class ModelManagement extends DeviceManagement<AdapterInstance, string> {
    readonly #backend: ModelBackend;

    /**
     * @param adapter the adapter, it receives the messages of the GUI
     * @param backend what the device manager needs from the adapter
     */
    public constructor(adapter: AdapterInstance, backend: ModelBackend) {
        super(adapter);
        this.#backend = backend;
    }

    protected async getInstanceInfo(): Promise<InstanceDetails> {
        const info = await super.getInstanceInfo();
        let status: NonNullable<InstanceDetails['indicators']>[number];
        try {
            const models = await this.#backend.listModels();
            const total = models.reduce((sum, model) => sum + model.size, 0);
            status = { id: 'totalSize', text: tr('dm_totalSize', formatSize(total)), tooltip: tr('dm_totalSizeHint') };
        } catch {
            status = { id: 'notReachable', text: tr('dm_notReachable'), color: 'error' };
        }
        return {
            ...info,
            actions: [
                {
                    id: 'pull',
                    icon: 'add',
                    title: tr('dm_download'),
                    description: tr('dm_downloadHint'),
                    handler: context => this.#onPull(context),
                },
            ],
            indicators: [status],
        };
    }

    protected async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
        let models: ModelInfo[];
        try {
            models = await this.#backend.listModels();
        } catch (error) {
            this.log.debug(`Cannot list the models for the device manager: ${errorText(error)}`);
            models = [];
        }
        context.setTotalDevices(models.length);
        const now = Date.now();
        for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
            context.addDevice(this.#toDevice(model, now));
        }
    }

    /**
     * The card of a model
     *
     * @param model the model
     * @param now current time in ms
     */
    #toDevice(model: ModelInfo, now: number): DeviceInfo<string> {
        const settings = this.#backend.getSettings();
        const isDefault = !!settings.defaultModel && sameModel(settings.defaultModel, model.name);
        const channelId = this.#backend.getChannelId(model.name);
        const lastUsed = this.#backend.getLastUsed(model.name);
        const size = formatSize(model.size);

        const items: Record<string, ConfigItemAny> = {
            size: { type: 'staticInfo', label: tr('dm_size'), data: size, xs: 12, sm: 12, md: 12, lg: 12, xl: 12 },
            lastUsed: {
                type: 'staticInfo',
                label: tr('dm_lastUsed'),
                data: lastUsed === undefined ? '-' : describeDays(daysSince(lastUsed, now)),
                xs: 12,
                sm: 12,
                md: 12,
                lg: 12,
                xl: 12,
            },
        };
        if (settings.deleteUnusedDays > 0) {
            const left = settings.deleteUnusedDays - (lastUsed === undefined ? 0 : daysSince(lastUsed, now));
            items.autoDelete = {
                type: 'staticInfo',
                label: tr('dm_autoDelete'),
                data: isDefault
                    ? tr('dm_autoDeleteNever')
                    : left > 0
                      ? tr('dm_autoDeleteIn', left)
                      : tr('dm_autoDeleteSoon'),
                xs: 12,
                sm: 12,
                md: 12,
                lg: 12,
                xl: 12,
            };
        }

        const indicators: NonNullable<DeviceInfo<string>['indicators']> = [];
        if (channelId) {
            indicators.push({
                id: 'loaded',
                value: { stateId: `${channelId}.loaded` },
                icon: 'play',
                color: 'ok',
                tooltip: tr('dm_loaded'),
            });
        }
        if (isDefault) {
            indicators.push({ id: 'default', text: tr('dm_default'), color: 'primary', tooltip: tr('dm_defaultHint') });
        }

        return {
            id: model.name,
            name: model.name,
            icon: 'adapter/ai-server/ai-server.png',
            model: [model.parameterSize, model.quantization].filter(Boolean).join(' · '),
            indicators,
            customInfo: { id: model.name, schema: { type: 'panel', items } },
            actions: [
                {
                    id: 'load',
                    icon: 'play',
                    description: tr('dm_load'),
                    // loading a large model from a slow disk takes a while
                    timeout: settings.requestTimeoutMs + 5_000,
                    handler: (name, context) => this.#onSetLoaded(name, true, context),
                },
                {
                    id: 'unload',
                    icon: 'stop',
                    description: tr('dm_unload'),
                    timeout: SHORT_ACTION_MS,
                    handler: (name, context) => this.#onSetLoaded(name, false, context),
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    description: tr('dm_delete'),
                    confirmation: isDefault
                        ? tr('dm_deleteConfirmDefault', model.name, size)
                        : tr('dm_deleteConfirm', model.name, size),
                    timeout: SHORT_ACTION_MS,
                    handler: (name, context) => this.#onDelete(name, context),
                },
            ],
        };
    }

    async #onSetLoaded(name: string, load: boolean, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        try {
            await this.#backend.setLoaded(name, load);
        } catch (error) {
            await context.showMessage(tr('dm_failed', errorText(error)));
            return { refresh: 'none' };
        }
        // loading changes the last use
        return { refresh: load ? 'devices' : 'none' };
    }

    async #onDelete(name: string, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        try {
            await this.#backend.deleteModel(name);
        } catch (error) {
            await context.showMessage(tr('dm_failed', errorText(error)));
            return { refresh: 'none' };
        }
        // also the total size changes
        return { refresh: 'all' };
    }

    /**
     * Ask for the model and download it. The GUI expects a message at least every 5 seconds,
     * so the progress is sent every second, also when it did not change.
     *
     * @param context the dialogs of the GUI
     */
    async #onPull(context: ActionContext): Promise<InstanceRefreshResponse> {
        const installed = await this.#backend.listModels().catch(() => [] as ModelInfo[]);
        const options = RECOMMENDED_MODELS.filter(
            model => !installed.some(item => sameModel(item.name, model.name)),
        ).map(model => ({
            value: model.name,
            label: `${model.name} (${formatSize(model.size)})`,
            noTranslation: true,
        }));
        const data = await context.showForm(
            {
                type: 'panel',
                items: {
                    model: {
                        type: 'autocomplete',
                        label: tr('dm_modelName'),
                        help: tr('dm_modelHelp'),
                        freeSolo: true,
                        options,
                        xs: 12,
                        sm: 12,
                        md: 12,
                        lg: 12,
                        xl: 12,
                    },
                },
            },
            { data: { model: '' }, title: tr('dm_downloadTitle'), maxWidth: 'sm', applyDisabledRule: '!data.model' },
        );
        const model = typeof data?.model === 'string' ? data.model.trim() : '';
        if (!model) {
            return { refresh: false };
        }
        if (!isValidModelName(model)) {
            await context.showMessage(tr('dm_invalidName', model));
            return { refresh: false };
        }

        let percent = 0;
        let status = '';
        let finished = false;
        let failure: unknown = null;
        const download = this.#backend
            .pull(model, (newPercent, newStatus) => {
                percent = newPercent ?? percent;
                status = newStatus;
            })
            .catch(error => {
                failure = error;
            })
            .finally(() => {
                finished = true;
            });

        const progress = await context.openProgress(tr('dm_downloading', model), { value: 0, label: '0 %' });
        while (!finished) {
            const label = status && !status.startsWith('pulling') ? `${percent} % · ${status}` : `${percent} %`;
            if (!(await this.#within(progress.update({ value: percent, label }), GUI_GONE_MS))) {
                // the GUI was closed: the download goes on, its result is in the log and in info.lastError
                await download;
                return { refresh: true };
            }
            await this.#delay(PROGRESS_INTERVAL_MS, () => finished);
        }
        await progress.close();
        if (failure) {
            await context.showMessage(tr('dm_downloadFailed', model, errorText(failure)));
            return { refresh: false };
        }
        return { refresh: true };
    }

    /**
     * Wait until the promise is settled, but at most `ms`
     *
     * @param promise what to wait for
     * @param ms maximal time to wait
     * @returns true if the promise was settled in time
     */
    async #within(promise: Promise<unknown>, ms: number): Promise<boolean> {
        let settled = false;
        const done = (): void => {
            settled = true;
        };
        await Promise.race([promise.then(done, done), this.#delay(ms, () => settled)]);
        return settled;
    }

    /**
     * Wait with the timers of the adapter, so that they end on unload
     *
     * @param ms time to wait
     * @param done stops waiting early when it returns true, checked every 100 ms
     */
    #delay(ms: number, done: () => boolean): Promise<void> {
        const end = Date.now() + ms;
        return new Promise(resolve => {
            const check = (): void => {
                if (done() || Date.now() >= end || !this.adapter.setTimeout(check, 100)) {
                    resolve();
                }
            };
            check();
        });
    }
}
