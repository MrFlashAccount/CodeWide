import { requireNativeComponent, View, type ViewProps } from "react-native";
import { browserSheetContentAvailable } from "./browserSheetCapabilities";

const NativeContent = browserSheetContentAvailable
  ? requireNativeComponent<ViewProps>("CodeWideBrowserSheetContent")
  : View;

/** Blocks parent sheet gestures while preserving gestures delivered to the complete browser body. */
export function BrowserSheetContent(props: ViewProps): React.JSX.Element {
  return <NativeContent {...props} />;
}
