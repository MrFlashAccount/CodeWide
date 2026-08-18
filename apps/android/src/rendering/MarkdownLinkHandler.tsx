import { createContext, type ReactNode, useContext } from "react";

export type MarkdownLocalLinkHandler = (href: string) => boolean;

const MarkdownLocalLinkContext = createContext<MarkdownLocalLinkHandler | null>(null);

export function MarkdownLocalLinkProvider({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen: MarkdownLocalLinkHandler;
}) {
  return <MarkdownLocalLinkContext.Provider value={onOpen}>{children}</MarkdownLocalLinkContext.Provider>;
}

export function useMarkdownLocalLinkHandler(): MarkdownLocalLinkHandler | null {
  return useContext(MarkdownLocalLinkContext);
}
