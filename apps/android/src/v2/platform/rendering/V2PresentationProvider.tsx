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
  analytics: "analytics-outline",
  alert: "alert-circle",
  archive: "archive-outline",
  attach: "attach-outline",
  back: "arrow-back",
  changes: "git-compare-outline",
  chevronDown: "chevron-down",
  chevronForward: "chevron-forward",
  chevronUp: "chevron-up",
  checkCircle: "checkmark-circle",
  chat: "chatbubble-ellipses-outline",
  close: "close",
  construct: "construct-outline",
  create: "create-outline",
  filter: "filter-outline",
  fingerprint: "finger-print",
  flash: "flash",
  folder: "folder-outline",
  forward: "chevron-forward",
  list: "list-outline",
  layers: "layers-outline",
  mic: "mic-outline",
  more: "ellipsis-vertical",
  ports: "git-network-outline",
  people: "people-outline",
  pin: "pin-outline",
  refresh: "refresh",
  radio: "ellipse-outline",
  search: "search",
  send: "arrow-up",
  server: "server-outline",
  settings: "settings-outline",
  shield: "shield-checkmark-outline",
  sparkles: "sparkles-outline",
  stop: "stop-circle",
  terminal: "terminal-outline",
};
