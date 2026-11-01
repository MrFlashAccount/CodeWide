// Node has one runtime. Preserve synchronous execution while native UI scheduling
// and Fabric commit ordering remain device/instrumentation validation concerns.
export type WorkletRuntime = { readonly name: string };

export function createWorkletRuntime({
  name = "test-worker",
}: { readonly name?: string } = {}): WorkletRuntime {
  return { name };
}

export async function runOnRuntimeAsync<Arguments extends unknown[], Result>(
  _runtime: WorkletRuntime,
  worklet: (...arguments_: Arguments) => Result,
  ...arguments_: Arguments
): Promise<Result> {
  return worklet(...arguments_);
}

export function runOnUISync(worklet: () => void): void {
  worklet();
}

export function scheduleOnUI<Arguments extends unknown[]>(
  worklet: (...arguments_: Arguments) => void,
  ...arguments_: Arguments
): void {
  worklet(...arguments_);
}

export function scheduleOnRN<Arguments extends unknown[]>(
  callback: (...arguments_: Arguments) => void,
  ...arguments_: Arguments
): void {
  callback(...arguments_);
}
