export type GlobalErrorSource = "global-handler" | "ota-prefetch" | "manual";

export type GlobalErrorSnapshot = {
  error: Error;
  isFatal: boolean;
  occurredAt: number;
  source: GlobalErrorSource;
};

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => ErrorHandler;
  setGlobalHandler: (handler: ErrorHandler) => void;
};

let snapshot: GlobalErrorSnapshot | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function normalizeGlobalError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown JavaScript error");
  }
}

export function reportGlobalError(
  value: unknown,
  source: GlobalErrorSource = "manual",
  isFatal = true,
): void {
  snapshot = {
    error: normalizeGlobalError(value),
    isFatal,
    occurredAt: Date.now(),
    source,
  };
  emit();
}

export function clearGlobalError(): void {
  if (snapshot === null) return;
  snapshot = null;
  emit();
}

export function getGlobalErrorSnapshot(): GlobalErrorSnapshot | null {
  return snapshot;
}

export function subscribeGlobalError(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getErrorUtils(): ErrorUtilsLike | null {
  const candidate = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (
    candidate === undefined
    || typeof candidate.getGlobalHandler !== "function"
    || typeof candidate.setGlobalHandler !== "function"
  ) {
    return null;
  }
  return candidate;
}

/**
 * Installs before Expo Router so an uncaught JavaScript exception cannot leave
 * the native root with an empty gray surface. Render errors are still handled
 * by React boundaries; this is the last-resort path for event/bootstrap errors.
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  const errorUtils = getErrorUtils();
  if (errorUtils === null) return;

  const previousHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal = false) => {
    if (!isFatal) {
      previousHandler(error, false);
      return;
    }

    reportGlobalError(error, "global-handler", true);

    // Keep the developer RedBox and Metro diagnostics. In production the
    // recovery host replaces the empty native root and offers a clean reload.
    if (__DEV__) previousHandler(error, true);
  });
  installed = true;
}
