/**
 * The 3D view's side of the conformer worker. One request at a time, and the
 * newest one wins.
 *
 * LATEST WINS BY TERMINATION. A minimisation is one synchronous call inside
 * the worker, so a request made stale by the next edit cannot be cancelled
 * there — it would run to the end and delay the picture the user is waiting
 * for. So when a request arrives while another is in flight, the worker is
 * terminated, the old request resolves `null` ("superseded", not a failure)
 * and a fresh worker takes the new one. Restarting costs the script parse,
 * about a tenth of a second, which the debounce in front of this makes rare.
 *
 * Importing this module starts nothing; the worker is created on the first
 * request, so a session that never opens the 3D view never downloads it.
 */

import { deploymentRoot } from "@/lib/deployment";

import type { ConformerResponse, ConformerResult } from "./protocol";

/**
 * Generous: 150 heavy atoms with their hydrogens minimise in tens of seconds
 * on a laptop, and five seeds may be tried. A timeout still has to exist —
 * a worker whose script 404s reports an error event, but one that hangs
 * reports nothing.
 */
const TIMEOUT_MS = 180_000;

interface InFlight {
  readonly id: number;
  readonly resolve: (result: ConformerResult | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | undefined;
let inFlight: InFlight | undefined;
let nextId = 1;

export function conformerWorkerUrl(): string {
  return `${deploymentRoot()}conformer/conformer.worker.js`;
}

function settle(result: ConformerResult | null): void {
  const current = inFlight;
  if (current === undefined) return;
  inFlight = undefined;
  clearTimeout(current.timer);
  current.resolve(result);
}

function stopWorker(): void {
  worker?.terminate();
  worker = undefined;
}

function startWorker(): Worker {
  const created = new Worker(conformerWorkerUrl());
  created.onmessage = (event: MessageEvent<ConformerResponse>) => {
    if (inFlight?.id !== event.data.id) return;
    settle(event.data.result);
  };
  created.onerror = (event) => {
    event.preventDefault();
    stopWorker();
    settle({
      ok: false,
      reason: "worker",
      // A 404 on the script arrives with an EMPTY message (see the RDKit
      // bridge), so the sentence must not depend on it.
      message: `The 3D worker did not start${event.message ? `: ${event.message}` : ""}.`,
    });
  };
  return created;
}

/**
 * A conformer for `molblock`, or `null` when a newer request replaced this
 * one before it finished. Never rejects.
 */
export function requestConformer(molblock: string): Promise<ConformerResult | null> {
  if (inFlight !== undefined) {
    stopWorker();
    settle(null);
  }
  worker ??= startWorker();
  const id = nextId++;
  const target = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stopWorker();
      settle({
        ok: false,
        reason: "worker",
        message: `The 3D geometry took longer than ${TIMEOUT_MS / 1000} s and was stopped.`,
      });
    }, TIMEOUT_MS);
    inFlight = { id, resolve, timer };
    target.postMessage({ id, molblock });
  });
}

/** Ends the worker and any request in flight; the view calls it on close. */
export function disposeConformerWorker(): void {
  stopWorker();
  settle(null);
}
