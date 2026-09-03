export interface ApplicationRuntimeHandle {
  start?(): Promise<void> | void;
  stop(): Promise<void> | void;
}

type RuntimeGeneration = "legacy" | "v2";

interface ActiveRuntime {
  generation: RuntimeGeneration;
  handle: ApplicationRuntimeHandle;
}

let active: ActiveRuntime | null = null;
let transition: Promise<void> = Promise.resolve();

export async function activateRuntime(
  generation: RuntimeGeneration,
  create: () => ApplicationRuntimeHandle,
): Promise<ApplicationRuntimeHandle> {
  return serializeRuntimeTransition(async () => {
    if (active?.generation === generation) return active.handle;
    if (active !== null) {
      await active.handle.stop();
      active = null;
    }
    const handle = create();
    active = { generation, handle };
    try {
      await handle.start?.();
      return handle;
    } catch (error) {
      try {
        await handle.stop();
      } finally {
        active = null;
      }
      throw error;
    }
  });
}

export async function stopRuntime(generation: RuntimeGeneration): Promise<void> {
  await serializeRuntimeTransition(async () => {
    if (active?.generation !== generation) return;
    await active.handle.stop();
    active = null;
  });
}

/** @testOnly Observes the otherwise private runtime slot in lifecycle regression tests. */
export function activeRuntimeGeneration(): RuntimeGeneration | null {
  return active?.generation ?? null;
}

function serializeRuntimeTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transition.then(operation, operation);
  transition = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
