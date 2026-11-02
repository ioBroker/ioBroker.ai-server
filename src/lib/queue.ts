/**
 * Limits the number of requests that run at the same time. Further requests wait in a queue of limited length;
 * a request that does not fit into the queue fails at once.
 */

/** A request was rejected because too many requests are waiting */
export class QueueFullError extends Error {
    /** @param maxQueue the maximal number of waiting requests */
    constructor(maxQueue: number) {
        super(
            maxQueue > 0
                ? `Too many requests: ${maxQueue} are already waiting, try again later`
                : 'The model is busy, try again later',
        );
        this.name = 'QueueFullError';
    }
}

/** Options of the RequestQueue */
export interface RequestQueueOptions {
    /** Maximal number of requests running at the same time, at least 1 */
    parallel: number;
    /** Maximal number of waiting requests, 0 = none */
    maxQueue: number;
    /** Called whenever the number of running or waiting requests changes */
    onChange?: (running: number, waiting: number) => void;
}

interface Waiting {
    start: () => void;
    reject: (error: Error) => void;
}

/** Runs at most `parallel` tasks at the same time and lets at most `maxQueue` tasks wait */
export class RequestQueue {
    readonly #parallel: number;
    readonly #maxQueue: number;
    readonly #onChange?: (running: number, waiting: number) => void;
    readonly #waiting: Waiting[] = [];
    #running = 0;

    /** @param options limits and change listener */
    constructor(options: RequestQueueOptions) {
        this.#parallel = Math.max(1, Math.floor(Number(options.parallel) || 1));
        this.#maxQueue = Math.max(0, Math.floor(Number(options.maxQueue) || 0));
        this.#onChange = options.onChange;
    }

    /** Number of running tasks */
    get running(): number {
        return this.#running;
    }

    /** Number of waiting tasks */
    get waiting(): number {
        return this.#waiting.length;
    }

    /**
     * Run the task as soon as there is a free slot
     *
     * @param task the request
     * @returns the result of the task. Fails with QueueFullError if the queue is full
     */
    run<T>(task: () => Promise<T>): Promise<T> {
        if (this.#running < this.#parallel) {
            return this.#start(task);
        }
        if (this.#waiting.length >= this.#maxQueue) {
            return Promise.reject(new QueueFullError(this.#maxQueue));
        }
        return new Promise<T>((resolve, reject) => {
            this.#waiting.push({ start: () => this.#start(task).then(resolve, reject), reject });
            this.#changed();
        });
    }

    /**
     * Reject all waiting tasks, e.g. when the adapter stops. Running tasks are not touched
     *
     * @param error the reason given to the waiting tasks
     */
    clear(error: Error): void {
        const waiting = this.#waiting.splice(0);
        for (const item of waiting) {
            item.reject(error);
        }
        if (waiting.length) {
            this.#changed();
        }
    }

    async #start<T>(task: () => Promise<T>): Promise<T> {
        this.#running++;
        this.#changed();
        try {
            return await task();
        } finally {
            this.#running--;
            const next = this.#waiting.shift();
            if (next) {
                next.start();
            } else {
                this.#changed();
            }
        }
    }

    #changed(): void {
        this.#onChange?.(this.#running, this.#waiting.length);
    }
}
