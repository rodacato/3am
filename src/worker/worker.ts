/// <reference lib="webworker" />
import { loadCase } from '../content/registry';
import { handleRequest } from './handle';
import { WORKER_PROTOCOL_VERSION, type WorkerEnvelope, type WorkerReply } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerEnvelope>) => {
  const { id, body, v } = event.data;
  if (v !== WORKER_PROTOCOL_VERSION) return;
  let reply: WorkerReply;
  try {
    reply = { v, id, ok: true, result: await handleRequest(body, loadCase) };
  } catch (e) {
    reply = { v, id, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  scope.postMessage(reply);
};
