import { expect } from 'chai';
import { QueueFullError, RequestQueue } from './queue';

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

/** Let the queue process finished tasks */
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('RequestQueue', () => {
    it('runs at most `parallel` tasks and starts the waiting ones in order', async () => {
        const queue = new RequestQueue({ parallel: 2, maxQueue: 5 });
        const tasks = [deferred(), deferred(), deferred(), deferred()];
        const started: number[] = [];
        const results = tasks.map((task, index) =>
            queue.run(() => {
                started.push(index);
                return task.promise;
            }),
        );
        expect(started).to.deep.equal([0, 1]);
        expect(queue.running).to.equal(2);
        expect(queue.waiting).to.equal(2);

        tasks[1].resolve('b');
        await tick();
        expect(started).to.deep.equal([0, 1, 2]);
        tasks[0].resolve('a');
        tasks[2].resolve('c');
        await tick();
        expect(started).to.deep.equal([0, 1, 2, 3]);
        tasks[3].resolve('d');
        expect(await Promise.all(results)).to.deep.equal(['a', 'b', 'c', 'd']);
        expect(queue.running).to.equal(0);
    });

    it('rejects a task at once if the queue is full', async () => {
        const queue = new RequestQueue({ parallel: 1, maxQueue: 1 });
        const first = deferred();
        const running = queue.run(() => first.promise);
        const waiting = queue.run(() => Promise.resolve('second'));
        const error = await rejection(queue.run(() => Promise.resolve('third')));
        expect(error).to.be.instanceOf(QueueFullError);
        expect(error.message).to.contain('1 are already waiting');
        first.resolve('first');
        expect(await running).to.equal('first');
        expect(await waiting).to.equal('second');
    });

    it('lets nothing wait with maxQueue 0', async () => {
        const queue = new RequestQueue({ parallel: 1, maxQueue: 0 });
        const first = deferred();
        void queue.run(() => first.promise);
        const error = await rejection(queue.run(() => Promise.resolve('x')));
        expect(error).to.be.instanceOf(QueueFullError);
        expect(error.message).to.contain('busy');
        first.resolve('done');
    });

    it('frees the slot of a failed task', async () => {
        const queue = new RequestQueue({ parallel: 1, maxQueue: 1 });
        const failing = queue.run(() => Promise.reject(new Error('failed')));
        const next = queue.run(() => Promise.resolve('next'));
        expect((await rejection(failing)).message).to.equal('failed');
        expect(await next).to.equal('next');
    });

    it('rejects the waiting tasks on clear, the running ones go on', async () => {
        const queue = new RequestQueue({ parallel: 1, maxQueue: 2 });
        const first = deferred();
        const running = queue.run(() => first.promise);
        const waiting = queue.run(() => Promise.resolve('never'));
        queue.clear(new Error('stopping'));
        expect((await rejection(waiting)).message).to.equal('stopping');
        expect(queue.waiting).to.equal(0);
        first.resolve('first');
        expect(await running).to.equal('first');
    });

    it('reports every change of the running and waiting tasks', async () => {
        const changes: string[] = [];
        const queue = new RequestQueue({
            parallel: 1,
            maxQueue: 1,
            onChange: (running, waiting) => changes.push(`${running}/${waiting}`),
        });
        const first = deferred();
        const a = queue.run(() => first.promise);
        const b = queue.run(() => Promise.resolve('b'));
        first.resolve('a');
        await Promise.all([a, b]);
        expect(changes).to.deep.equal(['1/0', '1/1', '1/0', '0/0']);
    });
});
