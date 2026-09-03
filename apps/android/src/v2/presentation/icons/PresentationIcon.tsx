import { createContext, useContext, type PropsWithChildren, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

import { typeWeight } from "../../theme";

const ICON_FONT_FAMILY = "sans-serif";

export type PresentationIconName =
  | "add"
  | "analytics"
  | "alert"
  | "archive"
  | "attach"
  | "back"
  | "changes"
  | "chevronDown"
  | "chevronForward"
  | "chevronUp"
  | "checkCircle"
  | "chat"
  | "close"
  | "construct"
  | "create"
  | "filter"
  | "fingerprint"
  | "flash"
  | "folder"
  | "forward"
  | "hourglass"
  | "list"
  | "layers"
  | "mic"
  | "more"
  | "ports"
  | "people"
  | "pin"
  | "refresh"
  | "radio"
  | "search"
  | "send"
  | "server"
  | "settings"
  | "shield"
  | "sparkles"
  | "stop"
  | "terminal";

export interface PresentationIconProps {
  color: string;
  name: PresentationIconName;
  size: number;
}

export type PresentationIconRenderer = (props: PresentationIconProps) => ReactNode;

const PresentationIconContext = createContext<PresentationIconRenderer | null>(null);

export function PresentationIconProvider(
  props: PropsWithChildren<{ renderIcon: PresentationIconRenderer | null }>,
): React.JSX.Element {
  const { children, renderIcon } = props;
  return (
    <PresentationIconContext.Provider value={renderIcon}>
      {children}
    </PresentationIconContext.Provider>
  );
}

export function PresentationIcon(props: PresentationIconProps): React.JSX.Element {
  const { color, name, size } = props;
  const renderIcon = usePresentationIconRenderer();
  if (renderIcon !== null) return <>{renderIcon({ color, name, size })}</>;
  return (
    <Text style={[styles.icon, { color, fontSize: size, lineHeight: size + 2 }]}>
      {glyphs[name]}
    </Text>
  );
}

export function usePresentationIconRenderer(): PresentationIconRenderer | null {
  return useContext(PresentationIconContext);
}

const glyphs: Record<PresentationIconName, string> = {
  add: "+",
  analytics: "⌁",
  alert: "!",
  archive: "▣",
  attach: "⌁",
  back: "←",
  changes: "⑂",
  chevronDown: "⌄",
  chevronForward: "›",
  chevronUp: "⌃",
  checkCircle: "●",
  chat: "…",
  close: "×",
  construct: "◇",
  create: "+",
  filter: "≡",
  fingerprint: "◎",
  flash: "↯",
  folder: "□",
  forward: "›",
  hourglass: "⌛",
  list: "☷",
  layers: "▱",
  mic: "⌾",
  more: "⋮",
  ports: "⌘",
  people: "♙",
  pin: "⌖",
  refresh: "↻",
  radio: "○",
  search: "⌕",
  send: "↑",
  server: "▣",
  settings: "⚙",
  shield: "◇",
  sparkles: "✦",
  stop: "■",
  terminal: "›_",
};

const styles = StyleSheet.create({
  icon: { fontFamily: ICON_FONT_FAMILY, fontWeight: typeWeight.regular, textAlign: "center" },
});
