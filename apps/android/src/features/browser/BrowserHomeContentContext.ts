import { createContext, type ReactNode } from "react";

/** Composition supplies Home services for the browser's captured server, independently of chat selection. */
export type BrowserHomeContentRenderer = (
  connectionId: string | null,
  onNavigate: (url: string) => void,
) => ReactNode;

/** Browser owns the page; the injected services owner resolves its current destinations. */
export const BrowserHomeContentContext = createContext<{
  readonly connectionId: string | null;
  readonly render: BrowserHomeContentRenderer;
} | null>(null);
