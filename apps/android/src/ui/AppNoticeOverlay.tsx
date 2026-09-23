import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AppNoticeViewport } from "./AppNoticeViewport";

/** Root component hosted by Android's application-attached notice window. */
export function AppNoticeOverlay(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ alignSelf: "stretch" }}>
      <AppNoticeViewport />
    </GestureHandlerRootView>
  );
}
