import { createContext, useContext, useState, type PropsWithChildren } from "react";

import type { Action } from "./action";

type ActionRunnerValue = {
  active: string | null;
  failures: Readonly<Record<string, string>>;
  run(action: Action): void;
};

const Context = createContext<ActionRunnerValue>({
  active: null,
  failures: {},
  run: () => undefined,
});

export function ActionRunner({ children }: PropsWithChildren): React.JSX.Element {
  const [active, setActive] = useState<string | null>(null);
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({});
  return (
    <Context.Provider
      value={{
        active,
        failures,
        run: (action) => {
          if (active !== null || action.disabled === true) return;
          setActive(action.id);
          setFailures((current) => {
            if (!(action.id in current)) return current;
            // WHY: React state needs a new identity after removing one action-local failure.
            return Object.fromEntries(Object.entries(current).filter(([id]) => id !== action.id));
          });
          Promise.resolve(action.run())
            .catch(() => {
              setFailures((current) => ({
                ...current,
                [action.id]: "Action failed. Try again.",
              }));
            })
            .finally(() => setActive(null));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useActionRunner = (): ActionRunnerValue => useContext(Context);
