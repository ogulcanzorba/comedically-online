import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../src/lib/semaphore';

describe('Semaphore', () => {
  it('grants at most max concurrent slots', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const worker = async (): Promise<void> => {
      const release = await sem.acquire();
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      release();
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    assert.equal(peak, 2);
    assert.equal(sem.depth, 0);
  });

  it('wakes waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const first = await sem.acquire();
    const waiter = async (name: string): Promise<void> => {
      const release = await sem.acquire();
      order.push(name);
      release();
    };
    const b = waiter('b');
    const c = waiter('c');
    await new Promise((r) => setTimeout(r, 20));
    first();
    await Promise.all([b, c]);
    assert.deepEqual(order, ['b', 'c']);
    assert.equal(sem.depth, 0);
  });

  it('reports queued waiters via pending', async () => {
    const sem = new Semaphore(1);
    const first = await sem.acquire();
    assert.equal(sem.pending, 0);
    let released = false;
    const w = sem.acquire().then((r) => {
      released = true;
      r();
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sem.pending, 1);
    first();
    await w;
    assert.ok(released);
    assert.equal(sem.pending, 0);
  });
});
