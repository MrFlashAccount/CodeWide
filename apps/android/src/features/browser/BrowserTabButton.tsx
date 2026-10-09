import { useSelector } from "@legendapp/state/react";
import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet } from "react-native";
import { useEvent } from "../../react/useEvent";
import type { BrowserTabsModel } from "../../services/browser/browserTabsModel";
import type { BrowserTab } from "../../services/browser/browserTab";
import { colors, controlSize, iconSize, spacing } from "../../theme";
import { WorkspaceTab } from "../../ui/WorkspaceTab";
import { browserTabLabel } from "./browserNavigationPolicy";
import { BrowserTabContour } from "./BrowserTabContour";

/** Publishes page identity and selection separately from the close-tab action. */
export function BrowserTabButton(props: {
  readonly layout?: "strip" | "grid" | "list";
  readonly model: BrowserTabsModel;
  readonly onSelect?: () => void;
  readonly selected: boolean;
  readonly tab: BrowserTab;
}): React.JSX.Element {
  const metadata = useSelector(props.tab.metadata$);
  const favicon = useSelector(props.tab.favicon$);
  const label = browserTabLabel(metadata.url);
  const pageTitle = metadata.title.trim();
  const title = pageTitle.length === 0 ? label : pageTitle;
  const description = title === label ? title : `${title} · ${label}`;
  const strip = isStripLayout(props.layout);
  const select = useEvent(() => {
    props.model.select(props.tab.id);
    props.onSelect?.();
  });
  const close = useEvent(() => {
    props.model.close(props.tab.id);
    const snapshot = props.model.state$.peek();
    if (snapshot.kind === "tabs" && !props.model.canClose(snapshot.selected.id)) {
      props.onSelect?.();
    }
  });
  function renderContour(pressed: boolean): React.JSX.Element {
    return <BrowserTabContour pressed={pressed} selected={props.selected} />;
  }
  return (
    <WorkspaceTab
      closable={props.model.canClose(props.tab.id)}
      closeLabel={`Close browser tab: ${description}`}
      compact
      detail={props.layout === "grid" || props.layout === "list" ? label : null}
      label={title}
      layout={props.layout ?? "strip"}
      leading={<BrowserTabIcon favicon={favicon} label={label} />}
      loading={metadata.loading}
      onClose={close}
      onSelect={select}
      renderDecoration={strip ? renderContour : undefined}
      selected={props.selected}
      selectLabel={`Select browser tab: ${description}`}
      surfaceStyle={strip ? styles.joined : undefined}
    />
  );
}

const styles = StyleSheet.create({
  favicon: {
    height: iconSize.inline,
    width: iconSize.inline,
  },
  joined: {
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: controlSize.regular,
    overflow: "visible",
    paddingHorizontal: spacing.xs,
  },
});

function isStripLayout(layout: "strip" | "grid" | "list" | undefined): boolean {
  return layout === undefined || layout === "strip";
}

function BrowserTabIcon(props: {
  readonly favicon: string | null;
  readonly label: string;
}): React.JSX.Element {
  return props.favicon === null ? (
    <Ionicons
      color={colors.textMuted}
      name={props.label === "Home" ? "home-outline" : "globe-outline"}
      size={iconSize.inline}
    />
  ) : (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: props.favicon }}
      style={styles.favicon}
      testID="browser-tab-favicon"
    />
  );
}
