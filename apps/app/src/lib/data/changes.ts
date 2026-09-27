/**
 * "Something may have changed": a relay went through, a review came back.
 * The live data source (live.ts) re-reads on it; kept apart so the relayer
 * can announce a change without importing the data layer.
 */

const listeners = new Set<() => void>();

export function onDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChanged(): void {
  for (const listener of listeners) listener();
}

export function hasDataListeners(): boolean {
  return listeners.size > 0;
}
