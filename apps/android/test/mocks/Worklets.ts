// Node has one runtime. Preserve synchronous execution while native UI scheduling
// and Fabric commit ordering remain device/instrumentation validation concerns.
export function runOnUISync(worklet: () => void): void {
  worklet();
}
