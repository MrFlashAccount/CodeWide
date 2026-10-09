import { View } from "react-native";
import { DesktopInputSurface } from "../desktopInput/DesktopInputSurface";
import { WebView } from "react-native-webview";
import { useEvent } from "../../react/useEvent";
import { AppText as Text } from "../../ui/Typography";
import { browserAddressKeepsOrigin } from "./browser-address";
import { useBrowserBack } from "./browserBack";
import type { BrowserTabsControl, InternalBrowserHeader } from "./browserContract";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserLoadingBar } from "./BrowserLoadingBar";
import { useBrowserDevTools } from "./browserDevTools";
import { renderBrowserDevToolsPane } from "./BrowserDevToolsPane";
import { useBrowserFeedbackSession } from "./browserFeedbackSession";
import { useBrowserNavigationState } from "./browserNavigationState";
import { useBrowserPaneLayout } from "./browserPaneLayout";
import { BROWSER_FEEDBACK_BOOTSTRAP, type BrowserFeedbackCapability } from "./feedback";
import { styles } from "./InternalBrowser.styles";
import { BrowserPageFeedback } from "./BrowserPageFeedback";
import { useBrowserPageSession } from "./browserPageSession";
import { useBrowserFavicon } from "./useBrowserFavicon";

const DEFAULT_ORIGIN_WHITELIST = ["http://*", "https://*"];

export function InternalBrowser({
  active = true,
  credentialOrigin,
  feedback: suppliedFeedback,
  header,
  headers,
  onError,
  onFavicon,
  onHttpError,
  onNavigation,
  onOpenWindow,
  originWhitelist = DEFAULT_ORIGIN_WHITELIST,
  showCloseButton = true,
  tabsControl,
  url,
  wide = true,
}: {
  active?: boolean;
  credentialOrigin?: string;
  feedback?: BrowserFeedbackCapability;
  header?: InternalBrowserHeader;
  headers?: Readonly<Record<string, string>>;
  onError?: (description: string) => void;
  onFavicon?: (icon: string | null) => void;
  onHttpError?: (statusCode: number) => void;
  onNavigation?: (metadata: {
    readonly loading: boolean;
    readonly title: string;
    readonly url: string;
  }) => void;
  onOpenWindow?: (url: string) => boolean;
  originWhitelist?: string[];
  showCloseButton?: boolean;
  tabsControl?: BrowserTabsControl;
  url: string;
  wide?: boolean;
}) {
  const {
    addressEditing,
    addressSource,
    navigateAddress,
    navigation,
    setAddressEditing,
    updateNavigation,
    webView,
  } = useBrowserNavigationState(url);
  const favicon = useBrowserFavicon(onFavicon);
  const pageSession = useBrowserPageSession({
    active,
    favicon,
    navigateAddress,
    navigation,
    onClose: header?.onClose,
    onError,
    onHttpError,
    onNavigation,
    onOpenWindow,
    originWhitelist,
    updateNavigation,
    webView,
  });
  const reportToolError = useEvent((message: string) => {
    pageSession.showNotice("Developer tools are unavailable for this page");
    onError?.(message);
  });
  const devTools = useBrowserDevTools(webView, navigation, { active, onError: reportToolError });
  const { captureFeedback, feedback, feedbackCapturing, feedbackSelecting, selectFeedbackElement } =
    useBrowserFeedbackSession(
      suppliedFeedback,
      webView,
      devTools.captureScreenshot,
      devTools.isMounted,
      active,
    );
  const devToolsOpen = devTools.devToolsUrl !== null;
  const { dividerPanResponder, onContentLayout, targetPaneStyle, verticalDock } =
    useBrowserPaneLayout(devTools.devToolsDockSide, devToolsOpen);
  useBrowserBack(
    header,
    devTools.devToolsUrl,
    devTools.closeDevTools,
    navigation.canGoBack,
    webView,
    active,
  );
  const toggleDevTools = useEvent(() => {
    if (devToolsOpen) {
      devTools.closeDevTools();
    } else {
      void devTools.openDevTools().catch(() => {
        reportToolError("Could not open Chromium DevTools");
      });
    }
  });
  return (
    <View style={styles.root}>
      <BrowserToolbar
        addressEditing={addressEditing}
        devToolsBusy={devTools.devToolsLoading || devTools.devToolsDocumentLoading}
        devToolsOpen={devToolsOpen}
        feedbackCapturing={feedbackCapturing}
        feedbackEnabled={feedback !== undefined}
        feedbackSelecting={feedbackSelecting}
        header={header}
        initialUrl={url}
        navigation={navigation}
        onBack={pageSession.back}
        onEditingChange={setAddressEditing}
        onForward={pageSession.goForward}
        onNavigate={pageSession.navigate}
        onReload={pageSession.retry}
        onSelectFeedback={selectFeedbackElement}
        onStop={pageSession.stopLoading}
        onToggleDevTools={toggleDevTools}
        showCloseButton={showCloseButton}
        tabsControl={tabsControl}
        wide={wide}
      />
      <BrowserLoadingBar loading={navigation.loading} progress={pageSession.progress} />
      {feedbackSelecting && (
        <Text style={styles.browserNotice}>Tap an element to describe what should change</Text>
      )}
      <View
        onLayout={onContentLayout}
        style={[
          styles.content,
          verticalDock &&
            (devTools.devToolsDockSide === "left" ? styles.contentRowReverse : styles.contentRow),
        ]}
      >
        <View style={targetPaneStyle}>
          <DesktopInputSurface
            active={
              active &&
              !feedbackSelecting &&
              !navigation.loading &&
              pageSession.status.kind === "ready"
            }
            defaultProfile="general"
            label="Page"
            sessionKey={String(pageSession.revision)}
          >
            <WebView
              domStorageEnabled
              javaScriptCanOpenWindowsAutomatically={false}
              javaScriptEnabled
              key={pageSession.revision}
              originWhitelist={["*"]}
              ref={webView}
              setSupportMultipleWindows
              sharedCookiesEnabled
              source={{
                uri: addressSource.uri,
                ...(headers === undefined ||
                !browserAddressKeepsOrigin(credentialOrigin ?? url, addressSource.uri)
                  ? {}
                  : { headers }),
              }}
              style={styles.webView}
              thirdPartyCookiesEnabled={false}
              {...(feedback === undefined
                ? {}
                : {
                    injectedJavaScriptBeforeContentLoaded: BROWSER_FEEDBACK_BOOTSTRAP,
                    onMessage: captureFeedback,
                  })}
              onError={pageSession.pageFailed}
              onHttpError={pageSession.httpFailed}
              onLoadProgress={pageSession.progressChanged}
              onLoadStart={pageSession.loadingStarted}
              onNavigationStateChange={pageSession.navigationChanged}
              onOpenWindow={pageSession.newWindow}
              onRenderProcessGone={pageSession.rendererGone}
              onShouldStartLoadWithRequest={pageSession.shouldNavigate}
            />
          </DesktopInputSurface>
          {pageSession.status.kind === "notice" && (
            <BrowserPageFeedback
              onBack={pageSession.back}
              onRetry={pageSession.retry}
              status={pageSession.status}
            />
          )}
        </View>
        {renderBrowserDevToolsPane(
          devTools,
          navigation.url,
          onError,
          verticalDock,
          dividerPanResponder,
          active,
        )}
      </View>
    </View>
  );
}
