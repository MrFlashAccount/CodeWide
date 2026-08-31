import { createContext, useContext, type PropsWithChildren, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

export type PresentationIconName =
  | "add"
  | "alert"
  | "attach"
  | "changes"
  | "chat"
  | "construct"
  | "filter"
  | "flash"
  | "list"
  | "mic"
  | "search"
  | "send"
  | "settings"
  | "sparkles"
  | "terminal";

export interface PresentationIconProps {
  color: string;
  name: PresentationIconName;
  size: number;
}

export type PresentationIconRenderer = (props: PresentationIconProps) => ReactNode;

const PresentationIconContext = createContext<PresentationIconRenderer | null>(null);

export function PresentationIconProvider({
  children,
  renderIcon,
}: PropsWithChildren<{ renderIcon: PresentationIconRenderer }>): React.JSX.Element {
  return (
    <PresentationIconContext.Provider value={renderIcon}>
      {children}
    </PresentationIconContext.Provider>
  );
}

export function PresentationIcon({ color, name, size }: PresentationIconProps): React.JSX.Element {
  const renderIcon = useContext(PresentationIconContext);
  if (renderIcon !== null) return <>{renderIcon({ color, name, size })}</>;
  return (
    <Text style={[styles.icon, { color, fontSize: size, lineHeight: size + 2 }]}>
      {glyphs[name]}
    </Text>
  );
}

const glyphs: Record<PresentationIconName, string> = {
  add: "+",
  alert: "!",
  attach: "⌁",
  changes: "⑂",
  chat: "…",
  construct: "◇",
  filter: "≡",
  flash: "↯",
  list: "☷",
  mic: "⌾",
  search: "⌕",
  send: "↑",
  settings: "⚙",
  sparkles: "✦",
  terminal: "›_",
};

const styles = StyleSheet.create({
  icon: { fontFamily: "sans-serif", fontWeight: "400", textAlign: "center" },
});
