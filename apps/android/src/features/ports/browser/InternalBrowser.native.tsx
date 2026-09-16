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

const DEFAULT_ORIGIN_WHITELIST = ["http://*", "https://*"];

export function InternalBrowser({
  feedback: suppliedFeedback,
  header,
  headers,
  onError,
  onHttpError,
  originWhitelist = DEFAULT_ORIGIN_WHITELIST,
  url,
}: {
  feedback?: BrowserFeedbackCapability;
  header?: InternalBrowserHeader;
  headers?: Record<string, string>;
  onError?: (description: string) => void;
  onHttpError?: (statusCode: number) => void;
  originWhitelist?: string[];
  url: string;
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
  const devTools = useBrowserDevTools(webView, navigation, onError);
  const { captureFeedback, feedback, feedbackCapturing, feedbackSelecting, selectFeedbackElement } =
    useBrowserFeedbackSession(
      suppliedFeedback,
      webView,
      devTools.captureScreenshot,
      devTools.isMounted,
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
  );
  return (
    <View style={styles.root}>
      <View style={[styles.toolbar, addressEditing && styles.toolbarEditing]}>
        {!addressEditing && header !== undefined && (
          <Pressable
            accessibilityLabel={header.closeLabel}
            accessibilityRole="button"
            onPress={header.onClose}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
          </Pressable>
        )}
        {!addressEditing && (
          <BrowserButton
            disabled={!navigation.canGoBack}
            icon="chevron-back"
            label="Back"
            onPress={() => webView.current?.goBack()}
          />
        )}
        {!addressEditing && (
          <BrowserButton
            disabled={!navigation.canGoForward}
            icon="chevron-forward"
            label="Forward"
            onPress={() => webView.current?.goForward()}
          />
        )}
        {!addressEditing &&
          (navigation.loading ? (
            <BrowserButton
              icon="close"
              label="Stop loading"
              onPress={() => webView.current?.stopLoading()}
            />
          ) : (
            <BrowserButton
              icon="refresh"
              label="Reload"
              onPress={() => webView.current?.reload()}
            />
          ))}
        <BrowserAddressBar
          key={url}
          onEditingChange={setAddressEditing}
          onNavigate={navigateAddress}
          url={navigation.url}
        />
        {!addressEditing && feedback !== undefined && (
          <Pressable
            accessibilityLabel={
              feedbackSelecting ? "Cancel element selection" : "Select element to fix"
            }
            accessibilityRole="button"
            disabled={feedbackCapturing}
            onPress={selectFeedbackElement}
            style={styles.button}
          >
            {feedbackCapturing ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Ionicons
                color={feedbackSelecting ? colors.success : colors.textMuted}
                name="locate-outline"
                size={iconSize.action}
              />
            )}
          </Pressable>
        )}
        {!addressEditing && (
          <Pressable
            accessibilityLabel={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}
            accessibilityRole="button"
            accessibilityState={{
              busy: devTools.devToolsLoading || devTools.devToolsDocumentLoading,
              selected: devToolsOpen,
            }}
            disabled={devTools.devToolsLoading}
            onPress={() => {
              if (devToolsOpen) {
                devTools.closeDevTools();
              } else {
                devTools.openDevTools().catch((error: unknown) => {
                  onError?.(
                    error instanceof Error ? error.message : "Could not open Chromium DevTools",
                  );
                });
              }
            }}
            style={({ pressed }) => [
              styles.button,
              devToolsOpen && styles.activeButton,
              pressed && styles.pressed,
            ]}
          >
            {devTools.devToolsLoading ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Ionicons
                color={devToolsOpen ? colors.accent : colors.textMuted}
                name="code-slash"
                size={iconSize.action}
              />
            )}
          </Pressable>
        )}
      </View>
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
          <WebView
            domStorageEnabled
            javaScriptEnabled
            originWhitelist={originWhitelist}
            ref={webView}
            sharedCookiesEnabled
            source={{
              uri: addressSource.uri,
              ...(headers === undefined || !browserAddressKeepsOrigin(url, addressSource.uri)
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
            onError={(event) => onError?.(event.nativeEvent.description)}
            onHttpError={(event) => onHttpError?.(event.nativeEvent.statusCode)}
            onNavigationStateChange={updateNavigation}
            renderLoading={() => <ActivityIndicator color={colors.accent} style={styles.loading} />}
            startInLoadingState
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
