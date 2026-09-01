import type { PropsWithChildren } from "react";

export function MessageActionMenuProvider({ children }: PropsWithChildren): React.JSX.Element {
  return <>{children}</>;
}

export function useMessageActionMenu(): () => void {
  return () => undefined;
}
