import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";
import { BackHandler, View, useWindowDimensions } from "react-native";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { browserTabsInOrder, type BrowserTabsModel } from "../../services/browser/browserTabsModel";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserTabSurface } from "./BrowserTabSurface";
import { BrowserSheet } from "./BrowserSheet";
import { BrowserHomePage } from "./BrowserHomePage";
import { BrowserTabsOverview } from "./BrowserTabsOverview";
import { styles } from "./BrowserWorkspace.styles";

const WIDE_BROWSER_WIDTH = 600;

/** Presents a chat-owned tab catalog; dismissing this screen leaves its private catalog resident. */
export function BrowserWorkspace(props: {
  readonly active?: boolean;
  readonly initialView?: "page" | "tabs";
  readonly onClose: () => void;
  readonly presentationId?: string;
  readonly tabs: BrowserTabsModel;
}): React.JSX.Element {
  const snapshot = useSelector(props.tabs.state$);
  const view$ = useConstant(() =>
    observable({ grid: true, overview: props.initialView === "tabs" }),
  );
  const view = useSelector(view$);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BROWSER_WIDTH;
  const overview = view.overview && snapshot.kind === "tabs";
  const tabCount =
    snapshot.kind === "empty" ? 0 : snapshot.before.length + snapshot.after.length + 1;
  const showOverview = useEvent((): void => {
    view$.overview.set(true);
  });
  const showPage = useEvent((): void => {
    view$.overview.set(false);
  });
  const toggleLayout = useEvent((): void => {
    view$.grid.set(!view$.grid.peek());
  });
  const newTab = useEvent((): void => {
    props.tabs.openHome();
    showPage();
  });
  const openHomeAddress = useEvent((url: string): void => {
    props.tabs.open({ title: "Browser", url });
    showPage();
  });
  useEffect(() => {
    view$.overview.set(props.initialView === "tabs");
  }, [props.initialView, props.presentationId, view$]);
  const { active, onClose, tabs } = props;
  useEffect(() => {
    if (active === false || !overview) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tabs.state$.peek().kind === "empty") {
        onClose();
      } else {
        showPage();
      }
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [active, onClose, overview, showPage, tabs]);
  return (
    <BrowserSheet
      active={props.active !== false}
      onCollapse={props.onClose}
      presentationId={props.presentationId ?? props.tabs.id}
    >
      <View style={styles.root} testID="browser-workspace">
        {wide && !overview && <BrowserTabStrip onNewTab={newTab} tabs={props.tabs} />}
        <WorkspacePages
          active={props.active !== false && !overview}
          onClose={props.onClose}
          onManageTabs={showOverview}
          onNavigateHome={openHomeAddress}
          onNewTab={newTab}
          overview={overview}
          tabCount={tabCount}
          tabs={props.tabs}
          wide={wide}
        />
        {overview && (
          <BrowserTabsOverview
            grid={view.grid}
            onNewTab={newTab}
            onSelect={showPage}
            onToggleLayout={toggleLayout}
            tabs={props.tabs}
            wide={wide}
          />
        )}
      </View>
    </BrowserSheet>
  );
}

function WorkspacePages(props: {
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onManageTabs: () => void;
  readonly onNavigateHome: (url: string) => void;
  readonly onNewTab: () => void;
  readonly overview: boolean;
  readonly tabCount: number;
  readonly tabs: BrowserTabsModel;
  readonly wide: boolean;
}): React.JSX.Element {
  const snapshot = useSelector(props.tabs.state$);
  if (snapshot.kind === "empty") {
    return (
      <BrowserHomePage
        onClose={props.onClose}
        onNavigate={props.onNavigateHome}
        tabsControl={{ count: 0, onNewTab: props.onNewTab, onOpen: props.onManageTabs }}
        wide={props.wide}
      />
    );
  }
  const selectedId = snapshot.selected.id;
  return (
    <View style={[styles.pages, props.overview && styles.hiddenPage]}>
      {Array.from(browserTabsInOrder(snapshot), (tab) => (
        <BrowserTabSurface
          active={props.active && tab.id === selectedId}
          key={tab.id.value}
          onClose={props.onClose}
          onManageTabs={props.onManageTabs}
          onNewTab={props.onNewTab}
          tab={tab}
          tabCount={props.tabCount}
          tabs={props.tabs}
          wide={props.wide}
        />
      ))}
    </View>
  );
}
