import { Ionicons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";

import {
  PresentationIconProvider,
  type PresentationIconName,
  type PresentationIconRenderer,
} from "../../../presentation/icons/PresentationIcon";

export function V2PresentationProvider({ children }: PropsWithChildren): React.JSX.Element {
  return <PresentationIconProvider renderIcon={renderIcon}>{children}</PresentationIconProvider>;
}

const renderIcon: PresentationIconRenderer = ({ color, name, size }) => (
  <Ionicons color={color} name={ioniconNames[name]} size={size} />
);

const ioniconNames: Record<PresentationIconName, keyof typeof Ionicons.glyphMap> = {
  add: "add",
  alert: "alert-circle",
  attach: "attach-outline",
  changes: "git-branch-outline",
  chat: "chatbubble-ellipses-outline",
  construct: "construct-outline",
  filter: "filter-outline",
  flash: "flash",
  list: "list-outline",
  mic: "mic-outline",
  search: "search",
  send: "arrow-up",
  settings: "settings-outline",
  sparkles: "sparkles-outline",
  terminal: "terminal-outline",
};
