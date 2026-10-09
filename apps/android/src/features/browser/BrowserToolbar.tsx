import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppText } from "../../ui/Typography";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserButton } from "./BrowserButton";
import type { BrowserTabsControl, InternalBrowserHeader } from "./browserContract";
import type { BrowserNavigation } from "./browserNavigationState";
import { styles } from "./InternalBrowser.styles";

const MENU_TRIGGER_SIZE = { height: controlSize.touch, width: controlSize.touch } as const;

type BrowserToolbarProps = {
  readonly addressEditing: boolean;
  readonly devToolsBusy: boolean;
  readonly devToolsOpen: boolean;
  readonly feedbackCapturing: boolean;
  readonly feedbackEnabled: boolean;
  readonly feedbackSelecting: boolean;
  readonly header: InternalBrowserHeader | undefined;
  readonly home?: boolean;
  readonly initialUrl: string;
  readonly navigation: BrowserNavigation;
  readonly onBack: () => void;
  readonly onEditingChange: (editing: boolean) => void;
  readonly onForward: () => void;
  readonly onNavigate: (url: string) => void;
  readonly onReload: () => void;
  readonly onSelectFeedback: () => void;
  readonly onStop: () => void;
  readonly onToggleDevTools: () => void;
  readonly showCloseButton: boolean;
  readonly tabsControl: BrowserTabsControl | undefined;
  readonly wide: boolean;
};

/** Compact navigation row; inspection and capture remain explicit menu actions. */
export function BrowserToolbar(props: BrowserToolbarProps): React.JSX.Element {
  return (
    <View
      style={[styles.toolbar, props.addressEditing && styles.toolbarEditing]}
      testID="browser-toolbar"
    >
      {!props.addressEditing && <NavigationButtons {...props} />}
      <BrowserAddressBar
        key={props.initialUrl}
        onEditingChange={props.onEditingChange}
        onNavigate={props.onNavigate}
        url={props.navigation.url}
      />
      {!props.addressEditing && !props.wide && props.tabsControl !== undefined && (
        <TabsCounter control={props.tabsControl} />
      )}
      {!props.addressEditing && <BrowserOverflow {...props} />}
    </View>
  );
}

function BrowserOverflow(
  props: Pick<
    BrowserToolbarProps,
    | "devToolsBusy"
    | "devToolsOpen"
    | "feedbackCapturing"
    | "feedbackEnabled"
    | "feedbackSelecting"
    | "home"
    | "tabsControl"
    | "navigation"
    | "onForward"
    | "onReload"
    | "onSelectFeedback"
    | "onStop"
    | "onToggleDevTools"
    | "wide"
  >,
): React.JSX.Element {
  const actions = toolbarActions(props);
  const selectAction = useEvent((id: string): void => {
    if (id === "tabs") {
      openToolbarTabs(props.tabsControl);
    }
    if (id === "new") {
      openToolbarNewTab(props.tabsControl);
    }
    if (id === "load") {
      if (props.navigation.loading) {
        props.onStop();
      } else {
        props.onReload();
      }
    }
    if (id === "forward") {
      props.onForward();
    }
    if (id === "devtools") {
      props.onToggleDevTools();
    }
    if (id === "feedback") {
      props.onSelectFeedback();
    }
  });
  return (
    <ActionMenu
      accessibilityLabel="Browser menu"
      actions={actions}
      onSelect={selectAction}
      triggerSize={MENU_TRIGGER_SIZE}
    >
      <Pressable accessibilityLabel="Browser menu" accessibilityRole="button" style={styles.button}>
        <Ionicons color={colors.textMuted} name="ellipsis-horizontal" size={iconSize.action} />
      </Pressable>
    </ActionMenu>
  );
}

function NavigationButtons(
  props: Pick<
    BrowserToolbarProps,
    | "header"
    | "home"
    | "navigation"
    | "onBack"
    | "onForward"
    | "onReload"
    | "onStop"
    | "showCloseButton"
    | "wide"
  >,
): React.JSX.Element | null {
  return (
    <>
      {props.showCloseButton && props.header !== undefined && (
        <BrowserButton
          icon="close"
          label={props.header.closeLabel}
          onPress={props.header.onClose}
        />
      )}
      <BrowserButton
        disabled={!props.navigation.canGoBack}
        icon="chevron-back"
        label="Back"
        onPress={props.onBack}
      />
      {props.wide && (
        <BrowserButton
          disabled={!props.navigation.canGoForward}
          icon="chevron-forward"
          label="Forward"
          onPress={props.onForward}
        />
      )}
      {props.wide && (
        <BrowserButton
          disabled={props.home === true}
          icon={props.navigation.loading ? "close" : "refresh"}
          label={props.navigation.loading ? "Stop loading" : "Reload"}
          onPress={props.navigation.loading ? props.onStop : props.onReload}
        />
      )}
    </>
  );
}

function TabsCounter(props: { readonly control: BrowserTabsControl }): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={`Open browser tabs: ${String(props.control.count)}`}
      accessibilityRole="button"
      onPress={props.control.onOpen}
      style={[styles.button, styles.tabsButton]}
    >
      <Ionicons color={colors.textMuted} name="albums-outline" size={iconSize.action} />
      <AppText numberOfLines={1} style={styles.tabCount}>
        {props.control.count}
      </AppText>
    </Pressable>
  );
}

function toolbarActions(
  props: Pick<
    BrowserToolbarProps,
    | "home"
    | "tabsControl"
    | "wide"
    | "navigation"
    | "devToolsBusy"
    | "devToolsOpen"
    | "feedbackEnabled"
    | "feedbackCapturing"
    | "feedbackSelecting"
  >,
): ActionMenuItem[] {
  const actions: ActionMenuItem[] = [];
  if (props.wide && props.tabsControl !== undefined) {
    actions.push({ icon: "albums-outline", id: "tabs", label: "Tabs" });
  }
  if (props.tabsControl?.onNewTab !== undefined) {
    actions.push({ icon: "add", id: "new", label: "New tab" });
  }
  if (props.home === true) {
    return actions;
  }
  appendPageActions(props, actions);
  return actions;
}

function openToolbarNewTab(control: BrowserTabsControl | undefined): void {
  control?.onNewTab?.();
}

function openToolbarTabs(control: BrowserTabsControl | undefined): void {
  control?.onOpen();
}

function appendPageActions(
  props: Pick<
    BrowserToolbarProps,
    | "wide"
    | "navigation"
    | "devToolsBusy"
    | "devToolsOpen"
    | "feedbackEnabled"
    | "feedbackCapturing"
    | "feedbackSelecting"
  >,
  actions: ActionMenuItem[],
): void {
  if (!props.wide) {
    actions.push({
      disabled: !props.navigation.canGoForward,
      icon: "chevron-forward",
      id: "forward",
      label: "Forward",
    });
    actions.push({
      icon: props.navigation.loading ? "close" : "refresh",
      id: "load",
      label: props.navigation.loading ? "Stop loading" : "Reload",
    });
  }
  actions.push({
    disabled: props.devToolsBusy,
    icon: "code-slash",
    id: "devtools",
    label: props.devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools",
    selected: props.devToolsOpen,
  });
  if (props.feedbackEnabled) {
    actions.push({
      disabled: props.feedbackCapturing,
      icon: "locate-outline",
      id: "feedback",
      label: props.feedbackSelecting ? "Cancel element selection" : "Select element to fix",
    });
  }
}
