import type { TerminalRouteBindingProps } from "../../../application/react/TerminalPlatformContext";
import { useInitialTerminal } from "./useInitialTerminal";

export function TerminalRouteBinding(props: TerminalRouteBindingProps): null {
  useInitialTerminal(props);
  return null;
}
