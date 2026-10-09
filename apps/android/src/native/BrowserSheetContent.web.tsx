import { View, type ViewProps } from "react-native";

/** Keeps the platform seam renderable without a native sheet. */
export function BrowserSheetContent(props: ViewProps): React.JSX.Element {
  return <View {...props} />;
}
