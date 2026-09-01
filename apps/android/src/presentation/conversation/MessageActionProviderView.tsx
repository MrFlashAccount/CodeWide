import type { PropsWithChildren } from "react";

import { MessageActionMenuProvider } from "../../ui/MessageActionMenu";

export function MessageActionProviderView({ children }: PropsWithChildren): React.JSX.Element {
  return <MessageActionMenuProvider>{children}</MessageActionMenuProvider>;
}
