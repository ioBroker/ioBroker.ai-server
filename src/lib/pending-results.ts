import { randomUUID } from 'node:crypto';
import type { Timers } from './ollama-client';

/** Answer of {@link PendingResults.wait} */
export type WaitResult<T> = { done: true; result: T } | { done: false };

interface Job<T> {
    promise: Promise<T>;
    settled: boolean;
    failed: boolean;
    value?: T;
    error?: unknown;
    /** Deletes a result that nobody fetched */
    expiry?: unknown;
}

/** Options of {@link PendingResults} */
export interface PendingResultsOptions {
    /** How long a finished result waits to be fetched */
    keepMs: number;
    /** Timers of the adapter, so they are cleared on unload */
    timers: Timers;
}

/**
 * Results of requests that take longer than a client waits for one answer. The browser drops the answer of a
 * `sendTo` after 30 seconds, but a model on a CPU often needs longer. So the client starts the request and fetches
 * its result with further messages, each of which is answered within that time.
 */
export class PendingResults<T> {
    readonly #jobs = new Map<string, Job<T>>();
    readonly #options: PendingResultsOptions;

    /**
     * @param options how long results are kept, and the timers to use
     */
    constructor(options: PendingResultsOptions) {
        this.#options = options;
    }

    /** Number of results that were not fetched yet */
    get size(): number {
        return this.#jobs.size;
    }

    /**
     * Remember a running request
     *
     * @param task the request
     * @returns the ID to fetch the result with
     */
    start(task: Promise<T>): string {
        const id = randomUUID();
        const job: Job<T> = { promise: task, settled: false, failed: false };
        this.#jobs.set(id, job);
        const settle = (): void => {
            job.settled = true;
            if (this.#jobs.get(id) === job) {
                job.expiry = this.#options.timers.setTimeout(() => this.#jobs.delete(id), this.#options.keepMs);
            }
        };
        void task.then(
            value => {
                job.value = value;
                settle();
            },
            (error: unknown) => {
                job.failed = true;
                job.error = error;
                settle();
            },
        );
        return id;
    }

    /**
     * Wait for the result of a request, at most `maxWaitMs`. A fetched result is forgotten.
     *
     * @param id the ID returned by {@link start}
     * @param maxWaitMs how long to wait for a request that is still running
     * @returns the result, or `{ done: false }` if the request is still running. Throws the error of the request.
     */
    async wait(id: string, maxWaitMs: number): Promise<WaitResult<T>> {
        const job = this.#jobs.get(id);
        if (!job) {
            throw new Error('Unknown request: it was fetched already, or the instance was restarted meanwhile');
        }
        if (!job.settled) {
            let timer: unknown;
            await Promise.race([
                job.promise.catch(() => undefined),
                new Promise<void>(resolve => {
                    timer = this.#options.timers.setTimeout(resolve, maxWaitMs);
                }),
            ]);
            this.#options.timers.clearTimeout(timer);
            // the promise is settled now, but its handlers in start() may not have run yet
            await Promise.resolve();
            if (!job.settled) {
                return { done: false };
            }
        }
        this.#jobs.delete(id);
        this.#options.timers.clearTimeout(job.expiry);
        if (job.failed) {
            throw job.error;
        }
        return { done: true, result: job.value as T };
    }

    /** Forget all results, e.g. when the adapter stops */
    clear(): void {
        for (const job of this.#jobs.values()) {
            this.#options.timers.clearTimeout(job.expiry);
        }
        this.#jobs.clear();
    }
}
