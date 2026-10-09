import { Ionicons } from "@expo/vector-icons";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useContext } from "react";
import { StyleSheet, View } from "react-native";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { BROWSER_HOME_URL } from "../../services/browser/browserTab";
import { colors, iconSize, spacing, typeScale } from "../../theme";
import { AppText } from "../../ui/Typography";
import type { BrowserTabsControl } from "./browserContract";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserHomeContentContext } from "./BrowserHomeContentContext";

const HOME_NAVIGATION = {
  canGoBack: false,
  canGoForward: false,
  loading: false,
  title: "Home",
  url: BROWSER_HOME_URL,
};

function idle(): void {}

/** A local start page uses the same fixed navigation row without creating a blank WebView. */
export function BrowserHomePage(props: {
  readonly onClose: () => void;
  readonly onNavigate: (url: string) => void;
  readonly tabsControl: BrowserTabsControl;
  readonly wide: boolean;
}): React.JSX.Element {
  const editing$ = useConstant(() => observable(false));
  const content = useContext(BrowserHomeContentContext);
  const editing = useSelector(editing$);
  const setEditing = useEvent((value: boolean): void => {
    editing$.set(value);
  });
  return (
    <View style={styles.root} testID="browser-home">
      <BrowserToolbar
        addressEditing={editing}
        devToolsBusy
        devToolsOpen={false}
        feedbackCapturing={false}
        feedbackEnabled={false}
        feedbackSelecting={false}
        header={undefined}
        home
        initialUrl={BROWSER_HOME_URL}
        navigation={HOME_NAVIGATION}
        onBack={props.onClose}
        onEditingChange={setEditing}
        onForward={idle}
        onNavigate={props.onNavigate}
        onReload={idle}
        onSelectFeedback={idle}
        onStop={idle}
        onToggleDevTools={idle}
        showCloseButton={false}
        tabsControl={props.tabsControl}
        wide={props.wide}
      />
      {content === null ? <HomeContent /> : content.render(content.connectionId, props.onNavigate)}
    </View>
  );
}

function HomeContent(): React.JSX.Element {
  return (
    <View style={styles.content}>
      <Ionicons color={colors.textDim} name="home-outline" size={iconSize.illustration} />
      <AppText style={styles.title}>Home</AppText>
      <AppText style={styles.hint}>Enter an address above to open a page</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  hint: {
    color: colors.textMuted,
    textAlign: "center",
    ...typeScale.body,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
});
