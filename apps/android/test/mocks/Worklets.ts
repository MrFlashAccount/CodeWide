// Node has one runtime. Preserve synchronous execution while native UI scheduling
// and Fabric commit ordering remain device/instrumentation validation concerns.
export function runOnUISync(worklet: () => void): void {
  worklet();
}

export function scheduleOnRN<Arguments extends unknown[]>(
  callback: (...arguments_: Arguments) => void,
  ...arguments_: Arguments
): void {
  callback(...arguments_);
}
