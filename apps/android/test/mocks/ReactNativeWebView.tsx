import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { View } from "react-native";

interface WebViewMockProps {
  onMessage?(event: { nativeEvent: { data: string } }): void;
  renderLoading?(): ReactNode;
  startInLoadingState?: boolean;
  testID?: string;
}

export const webViewInjectedJavaScript: string[] = [];
export let latestWebViewProps: WebViewMockProps | null = null;

interface WebViewMockHandle {
  goBack(): void;
  goForward(): void;
  injectJavaScript(script: string): void;
  postMessage(message: string): void;
  reload(): void;
}

export const WebView = forwardRef<WebViewMockHandle, WebViewMockProps>(
  function WebViewMock(props, ref): React.JSX.Element {
    latestWebViewProps = props;
    useImperativeHandle(ref, () => ({
      goBack: () => undefined,
      goForward: () => undefined,
      injectJavaScript: (script) => {
        webViewInjectedJavaScript.push(script);
      },
      postMessage: () => undefined,
      reload: () => undefined,
    }));
    return (
      <View testID={props.testID ?? "webview-mock"}>
        {props.startInLoadingState === true ? props.renderLoading?.() : null}
      </View>
    );
  },
);
