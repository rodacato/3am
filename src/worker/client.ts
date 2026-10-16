import { WORKER_PROTOCOL_VERSION, type WorkerEnvelope, type WorkerReply, type WorkerRequest, type WorkerResult } from './protocol';

const CACHE_LIMIT = 64;

// Results are pure functions of the request, so a small LRU keyed by the request is always safe.
export class SimulationClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, Promise<unknown>>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const waiter = this.pending.get(event.data.id);
      if (!waiter) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) waiter.resolve(event.data.result);
      else waiter.reject(new Error(event.data.message));
    };
  }

  request<R extends WorkerRequest>(body: R): Promise<WorkerResult<R>> {
    const key = JSON.stringify(body);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit as Promise<WorkerResult<R>>;
    }
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const envelope: WorkerEnvelope = { v: WORKER_PROTOCOL_VERSION, id, body };
      this.worker.postMessage(envelope);
    });
    promise.catch(() => this.cache.delete(key));
    this.cache.set(key, promise);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    return promise as Promise<WorkerResult<R>>;
  }

  dispose() {
    this.worker.terminate();
  }
}
