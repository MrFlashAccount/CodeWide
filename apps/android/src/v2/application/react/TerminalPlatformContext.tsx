import { createContext, useContext, type ComponentType, type PropsWithChildren } from "react";
import type { V2U64 } from "@codewide/sync-client/v2";

import type { TerminalController } from "../terminalController";
import type { TerminalSession } from "../../domain/terminalSession";
import type { QualifiedThread } from "../../domain/qualifiedThread";

interface TerminalRendererProps {
  controller: TerminalController;
  session: TerminalSession;
}

export interface TerminalRouteBindingProps {
  controller: TerminalController;
  cwd: string | null;
  enabled: boolean;
  generation: V2U64 | null;
  onError(message: string): void;
  owner: QualifiedThread;
}

export interface TerminalPlatform {
  Renderer: ComponentType<TerminalRendererProps>;
  RouteBinding: ComponentType<TerminalRouteBindingProps>;
}

interface TerminalPlatformProviderProps extends PropsWithChildren {
  platform: TerminalPlatform;
}

const Context = createContext<TerminalPlatform | null>(null);

export function TerminalPlatformProvider(props: TerminalPlatformProviderProps): React.JSX.Element {
  const { children, platform } = props;
  return <Context.Provider value={platform}>{children}</Context.Provider>;
}

export function useTerminalPlatform(): TerminalPlatform {
  const platform = useContext(Context);
  if (platform === null) throw new Error("V2 Terminal platform is not mounted");
  return platform;
}
