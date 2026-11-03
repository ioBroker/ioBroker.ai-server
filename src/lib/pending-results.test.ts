import { expect } from 'chai';
import type { Timers } from './ollama-client';
import { PendingResults } from './pending-results';

/** A task that ends when the test says so */
function deferred<T = string>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('The promise was not rejected');
}

/** Timers that only fire when the test calls `fire` */
function manualTimers(): Timers & { pending: () => number; fire: (ms: number) => void } {
    let timers: { callback: () => void; ms: number }[] = [];
    return {
        setTimeout: (callback, ms) => {
            const timer = { callback, ms };
            timers.push(timer);
            return timer;
        },
        clearTimeout: handle => {
            timers = timers.filter(timer => timer !== handle);
        },
        pending: () => timers.length,
        fire: ms => {
            const due = timers.filter(timer => timer.ms === ms);
            timers = timers.filter(timer => timer.ms !== ms);
            due.forEach(timer => timer.callback());
        },
    };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('PendingResults', () => {
    it('returns the result of a finished request once', async () => {
        const timers = manualTimers();
        const results = new PendingResults<string>({ keepMs: 600_000, timers });
        const task = deferred();
        const id = results.start(task.promise);
        task.resolve('answer');
        await tick();

        expect(await results.wait(id, 20_000)).to.deep.equal({ done: true, result: 'answer' });
        expect(results.size).to.equal(0);
        expect(timers.pending()).to.equal(0);
        expect((await rejection(results.wait(id, 20_000))).message).to.match(/^Unknown request/);
    });

    it('says "not done" when the request takes longer than the wait', async () => {
        const timers = manualTimers();
        const results = new PendingResults<string>({ keepMs: 600_000, timers });
        const task = deferred();
        const id = results.start(task.promise);

        const first = results.wait(id, 20_000);
        await tick();
        timers.fire(20_000);
        expect(await first).to.deep.equal({ done: false });

        const second = results.wait(id, 20_000);
        task.resolve('late answer');
        expect(await second).to.deep.equal({ done: true, result: 'late answer' });
        expect(timers.pending()).to.equal(0);
    });

    it('passes the error of the request on', async () => {
        const results = new PendingResults<string>({ keepMs: 600_000, timers: manualTimers() });
        const task = deferred();
        const id = results.start(task.promise);
        const waiting = results.wait(id, 20_000);
        task.reject(new Error('model not found'));

        expect((await rejection(waiting)).message).to.equal('model not found');
        expect(results.size).to.equal(0);
    });

    it('forgets a result that nobody fetches', async () => {
        const timers = manualTimers();
        const results = new PendingResults<string>({ keepMs: 600_000, timers });
        const task = deferred();
        const id = results.start(task.promise);
        task.resolve('answer');
        await tick();

        timers.fire(600_000);
        expect(results.size).to.equal(0);
        expect((await rejection(results.wait(id, 20_000))).message).to.match(/^Unknown request/);
    });

    it('clears all results and their timers', async () => {
        const timers = manualTimers();
        const results = new PendingResults<string>({ keepMs: 600_000, timers });
        const task = deferred();
        results.start(task.promise);
        task.resolve('answer');
        await tick();

        results.clear();
        expect(results.size).to.equal(0);
        expect(timers.pending()).to.equal(0);
    });
});
