/** Native resources owned by the mounted V1 workspace, separate from process-level JS state. */
export interface ApplicationRuntimeHandle {
  start?: () => Promise<void> | void;
  stop: () => Promise<void> | void;
}

let active: ApplicationRuntimeHandle | null = null;
let transition: Promise<void> = Promise.resolve();

/** Serializes native activation behind any preceding workspace cleanup. */
export async function activateRuntime(
  create: () => ApplicationRuntimeHandle,
): Promise<ApplicationRuntimeHandle> {
  return serializeRuntimeTransition(async () => {
    if (active !== null) {
      return active;
    }
    const handle = create();
    active = handle;
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

/** Releases the mounted workspace's native resources before another activation can begin. */
export async function stopRuntime(): Promise<void> {
  await serializeRuntimeTransition(async () => {
    if (active === null) {
      return;
    }
    await active.stop();
    active = null;
  });
}

async function serializeRuntimeTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transition.then(operation, operation);
  transition = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
