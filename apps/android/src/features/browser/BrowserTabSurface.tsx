import { useSelector } from "@legendapp/state/react";
import { View } from "react-native";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import type { BrowserTabsModel } from "../../services/browser/browserTabsModel";
import type { BrowserTabsControl } from "./browserContract";
import type { BrowserPageDestination, BrowserTab } from "../../services/browser/browserTab";
import { BrowserHomePage } from "./BrowserHomePage";
import { InternalBrowser } from "./InternalBrowser";
import { styles } from "./BrowserWorkspace.styles";

/** Retains one native page through tab selection and browser collapse. */
export function BrowserTabSurface(props: {
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onManageTabs: () => void;
  readonly onNewTab: () => void;
  readonly tab: BrowserTab;
  readonly tabCount: number;
  readonly tabs: BrowserTabsModel;
  readonly wide: boolean;
}): React.JSX.Element {
  const source = useSelector(props.tab.source$);
  const openAddress = useEvent((url: string): void => {
    props.tab.openPageFromHome({ title: "Browser", url });
  });
  const publishNavigation = useEvent((metadata: Parameters<BrowserTab["publish"]>[0]) => {
    props.tab.publish(metadata);
  });
  const publishFavicon = useEvent((icon: string | null) => {
    props.tab.publishFavicon(icon);
  });
  const openWindow = useEvent((url: string) => {
    // Page-created tabs never inherit caller-provided tunnel headers.
    props.tabs.open({ title: "Browser", url });
    return true;
  });
  return (
    <View
      accessibilityElementsHidden={!props.active}
      importantForAccessibility={props.active ? "auto" : "no-hide-descendants"}
      pointerEvents={props.active ? "auto" : "none"}
      style={[styles.page, !props.active && styles.hiddenPage]}
    >
      {source.kind === "home" ? (
        <BrowserHomePage
          onClose={props.onClose}
          onNavigate={openAddress}
          tabsControl={{
            count: props.tabCount,
            onNewTab: props.onNewTab,
            onOpen: props.onManageTabs,
          }}
          wide={props.wide}
        />
      ) : (
        <NativeTabPage
          active={props.active}
          destination={source.destination}
          onClose={props.onClose}
          onFavicon={publishFavicon}
          onNavigation={publishNavigation}
          onOpenWindow={openWindow}
          tabsControl={{
            count: props.tabCount,
            onNewTab: props.onNewTab,
            onOpen: props.onManageTabs,
          }}
          wide={props.wide}
        />
      )}
    </View>
  );
}

function NativeTabPage(props: {
  readonly active: boolean;
  readonly destination: BrowserPageDestination;
  readonly onClose: () => void;
  readonly onFavicon: (icon: string | null) => void;
  readonly onNavigation: (metadata: Parameters<BrowserTab["publish"]>[0]) => void;
  readonly onOpenWindow: (url: string) => boolean;
  readonly tabsControl: BrowserTabsControl;
  readonly wide: boolean;
}): React.JSX.Element {
  const initialUrl = useConstant(() => props.destination.url);
  return (
    <InternalBrowser
      active={props.active}
      header={{ closeLabel: "Collapse browser", onClose: props.onClose, title: "Browser" }}
      onFavicon={props.onFavicon}
      onNavigation={props.onNavigation}
      onOpenWindow={props.onOpenWindow}
      showCloseButton={false}
      tabsControl={props.tabsControl}
      url={initialUrl}
      wide={props.wide}
      {...(props.destination.headers === undefined
        ? {}
        : {
            credentialOrigin: props.destination.url,
            headers: props.destination.headers,
          })}
    />
  );
}
