import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { browserAddressKeepsOrigin } from "./browser-address";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { useBrowserBack } from "./browserBack";
import { BrowserButton } from "./BrowserButton";
import type { InternalBrowserHeader } from "./browserContract";
import { useBrowserDevTools } from "./browserDevTools";
import { renderBrowserDevToolsPane } from "./BrowserDevToolsPane";
import { useBrowserFeedbackSession } from "./browserFeedbackSession";
import { useBrowserNavigationState } from "./browserNavigationState";
import { useBrowserPaneLayout } from "./browserPaneLayout";
import { BROWSER_FEEDBACK_BOOTSTRAP, type BrowserFeedbackCapability } from "./feedback";
import { styles } from "./InternalBrowser.styles";
export function InternalBrowser({
  url,
  headers,
  header,
  originWhitelist = ["http://*", "https://*"],
  onHttpError,
  onError,
  feedback: suppliedFeedback,
}: {
  url: string;
  headers?: Record<string, string>;
  header?: InternalBrowserHeader;
  originWhitelist?: string[];
  onHttpError?(statusCode: number): void;
  onError?(description: string): void;
  feedback?: BrowserFeedbackCapability;
}) {
  const {
    webView,
    addressSource,
    navigation,
    navigateAddress,
    updateNavigation,
    addressEditing,
    setAddressEditing,
  } = useBrowserNavigationState(url);
  const devTools = useBrowserDevTools(webView, navigation, onError);
  const { feedback, feedbackSelecting, feedbackCapturing, selectFeedbackElement, captureFeedback } =
    useBrowserFeedbackSession(
      suppliedFeedback,
      webView,
      devTools.captureScreenshot,
      devTools.isMounted,
    );
  const devToolsOpen = devTools.devToolsUrl !== null;
  const { dividerPanResponder, onContentLayout, verticalDock, targetPaneStyle } =
    useBrowserPaneLayout(devTools.devToolsDockSide, devToolsOpen);
  useBrowserBack(
    header,
    devTools.devToolsUrl,
    devTools.closeDevTools,
    navigation.canGoBack,
    webView,
  );
  return (
    <View style={styles.root}>
      <View style={[styles.toolbar, addressEditing && styles.toolbarEditing]}>
        {!addressEditing && header !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={header.closeLabel}
            onPress={header.onClose}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
          </Pressable>
        )}
        {!addressEditing && (
          <BrowserButton
            label="Back"
            icon="chevron-back"
            disabled={!navigation.canGoBack}
            onPress={() => webView.current?.goBack()}
          />
        )}
        {!addressEditing && (
          <BrowserButton
            label="Forward"
            icon="chevron-forward"
            disabled={!navigation.canGoForward}
            onPress={() => webView.current?.goForward()}
          />
        )}
        {!addressEditing &&
          (navigation.loading ? (
            <BrowserButton
              label="Stop loading"
              icon="close"
              onPress={() => webView.current?.stopLoading()}
            />
          ) : (
            <BrowserButton
              label="Reload"
              icon="refresh"
              onPress={() => webView.current?.reload()}
            />
          ))}
        <BrowserAddressBar
          key={url}
          url={navigation.url}
          onEditingChange={setAddressEditing}
          onNavigate={navigateAddress}
        />
        {!addressEditing && feedback !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              feedbackSelecting ? "Cancel element selection" : "Select element to fix"
            }
            disabled={feedbackCapturing}
            onPress={selectFeedbackElement}
            style={styles.button}
          >
            {feedbackCapturing ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons
                name="locate-outline"
                size={iconSize.action}
                color={feedbackSelecting ? colors.success : colors.textMuted}
              />
            )}
          </Pressable>
        )}
        {!addressEditing && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}
            accessibilityState={{
              selected: devToolsOpen,
              busy: devTools.devToolsLoading || devTools.devToolsDocumentLoading,
            }}
            disabled={devTools.devToolsLoading}
            onPress={() => (devToolsOpen ? devTools.closeDevTools() : void devTools.openDevTools())}
            style={({ pressed }) => [
              styles.button,
              devToolsOpen && styles.activeButton,
              pressed && styles.pressed,
            ]}
          >
            {devTools.devToolsLoading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons
                name="code-slash"
                size={iconSize.action}
                color={devToolsOpen ? colors.accent : colors.textMuted}
              />
            )}
          </Pressable>
        )}
      </View>
      {feedbackSelecting && (
        <Text style={styles.browserNotice}>Tap an element to describe what should change</Text>
      )}
      <View
        style={[
          styles.content,
          verticalDock &&
            (devTools.devToolsDockSide === "left" ? styles.contentRowReverse : styles.contentRow),
        ]}
        onLayout={onContentLayout}
      >
        <View style={targetPaneStyle}>
          <WebView
            ref={webView}
            style={styles.webView}
            source={{
              uri: addressSource.uri,
              ...(headers === undefined || !browserAddressKeepsOrigin(url, addressSource.uri)
                ? {}
                : { headers }),
            }}
            originWhitelist={originWhitelist}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            {...(feedback === undefined
              ? {}
              : {
                  injectedJavaScriptBeforeContentLoaded: BROWSER_FEEDBACK_BOOTSTRAP,
                  onMessage: captureFeedback,
                })}
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={styles.loading} color={colors.accent} />}
            onNavigationStateChange={updateNavigation}
            onHttpError={(event) => onHttpError?.(event.nativeEvent.statusCode)}
            onError={(event) => onError?.(event.nativeEvent.description)}
          />
        </View>
        {renderBrowserDevToolsPane(
          devTools,
          navigation.url,
          onError,
          verticalDock,
          dividerPanResponder,
        )}
      </View>
    </View>
  );
}
