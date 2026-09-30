import type { ReactNode } from "react";

import type { OpenMessageActionMenu } from "../../src/ui/MessageActionMenu.types";

const openMessageActionMenu: OpenMessageActionMenu = () => undefined;

/** Browser experiment host: actions are inert while their production rail geometry remains real. */
export function MessageActionMenuProvider({ children }: { readonly children: ReactNode }) {
  return children;
}

export function useMessageActionMenu(): OpenMessageActionMenu {
  return openMessageActionMenu;
}
