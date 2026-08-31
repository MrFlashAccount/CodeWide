export interface ApplicationRuntimeHandle {
  stop(): Promise<void> | void;
}

let active: { generation: "legacy" | "v2"; handle: ApplicationRuntimeHandle } | null = null;

export async function activateRuntime(
  generation: "legacy" | "v2",
  create: () => ApplicationRuntimeHandle,
): Promise<ApplicationRuntimeHandle> {
  if (active?.generation === generation) return active.handle;
  if (active !== null) await active.handle.stop();
  const handle = create();
  active = { generation, handle };
  return handle;
}

export async function stopRuntime(generation: "legacy" | "v2"): Promise<void> {
  if (active?.generation !== generation) return;
  const current = active;
  active = null;
  await current.handle.stop();
}

export function activeRuntimeGeneration(): "legacy" | "v2" | null {
  return active?.generation ?? null;
}
