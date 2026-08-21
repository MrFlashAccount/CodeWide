/**
 * Owns the currently active TanStack sync writer. Collection lifecycle cleanup
 * can overlap a replacement start; an older cleanup must never clear the newer
 * writer or live events will be acknowledged without reaching the detail view.
 */
export function createSyncControlLease<T>() {
  let current: T | null = null;

  return {
    get(): T | null {
      return current;
    },
    install(value: T): () => void {
      current = value;
      return () => {
        if (current === value) current = null;
      };
    },
  };
}
