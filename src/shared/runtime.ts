/** Chrome can invalidate a content script between the guard and the API call. */
let invalidated = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function invalidate(): void {
  if (invalidated) return;
  invalidated = true;
  clearInterval(timer);
  timer = undefined;
  const cleanup = [...listeners];
  listeners.clear();
  for (const stop of cleanup) stop();
}

export function extensionAlive(): boolean {
  if (invalidated) return false;
  try {
    if (globalThis.chrome?.runtime?.id) return true;
  } catch { /* Some Chrome versions throw while reading the old context. */ }
  invalidate();
  return false;
}

function expired(error: unknown): boolean {
  if (error instanceof Error && /extension context invalidated/i.test(error.message)) {
    invalidate();
    return true;
  }
  return !extensionAlive();
}

/** Catches synchronous API throws, including the race after extensionAlive(). */
export function extensionValue<T>(read: () => T, fallback: T): T {
  if (!extensionAlive()) return fallback;
  try { return read(); } catch (error) {
    if (expired(error)) return fallback;
    throw error;
  }
}

/** The callback is essential: calling the API before this wrapper can throw. */
export async function extensionCall<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (!extensionAlive()) return undefined;
  try { return await run(); } catch (error) {
    if (expired(error)) return undefined;
    throw error;
  }
}

/** Event handlers must also handle ordinary rejected promises, without hiding them. */
export function extensionTask(run: () => Promise<unknown>): void {
  void extensionCall(run).catch((error: unknown) => console.error('[Contacts Rail]', error));
}

/** Stop observers, timers and UI even when no more Chrome API calls are made. */
export function onExtensionInvalidated(stop: () => void): () => void {
  if (!extensionAlive()) { stop(); return () => {}; }
  listeners.add(stop);
  timer ??= setInterval(() => { extensionAlive(); }, 1000);
  return () => {
    listeners.delete(stop);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}
