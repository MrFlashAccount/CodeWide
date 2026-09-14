import { useSelector } from "@legendapp/state/react";
import type { ReactNode } from "react";

import type {
  ConversationDestination,
  ThreadNavigationModel,
} from "../data/thread-navigation-model";

/** Reads navigation below the workspace shell, including draft and search transitions. */
export function WorkspaceConversationHost({
  navigation,
  renderConversation,
}: {
  navigation: ThreadNavigationModel;
  renderConversation(destination: ConversationDestination): ReactNode;
}) {
  const destination = useSelector(() => navigation.destination$.get());
  return renderConversation(destination);
}

/** Mobile switches surfaces; desktop keeps the same sidebar mounted across chat changes. */
export function WorkspaceThreadListVisibility({
  navigation,
  desktop,
  children,
}: {
  navigation: ThreadNavigationModel;
  desktop: boolean;
  children: ReactNode;
}) {
  const show = useSelector(() => desktop || navigation.destination$.get().kind === "empty");
  return show ? children : null;
}
