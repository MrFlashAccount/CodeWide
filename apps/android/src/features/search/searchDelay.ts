export function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
