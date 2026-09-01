import type { PropsWithChildren } from "react";

import { MessageActionMenuProvider } from "../../ui/MessageActionMenu";

export function MessageActionProviderView(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  return <MessageActionMenuProvider>{children}</MessageActionMenuProvider>;
}
