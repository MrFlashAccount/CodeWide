import type { GlobalSupervisorBinding } from "./globalSupervisorBinding";
import type { GlobalSupervisorBindingDatabase } from "./globalSupervisorBindingDatabase.types";

export function createGlobalSupervisorBindingDatabase(): GlobalSupervisorBindingDatabase {
  let binding: GlobalSupervisorBinding | null = null;
  return {
    async clear() {
      binding = null;
      await Promise.resolve();
    },
    async read() {
      await Promise.resolve();
      return binding;
    },
    ready: Promise.resolve(),
    async write(next) {
      binding = next;
      await Promise.resolve();
    },
  };
}
