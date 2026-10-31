import { Pressable, Text, View } from "react-native";

import { useThreePanels } from "../../src/ui/threePanels";

/**
 * Renders the pane chrome `ThreePanelsContext` publishes the way a pane header does: the fullscreen
 * toggle and the pane's close, so route tests can drive pane actions without the real content.
 */
export function PaneChromeControls({
  name,
}: {
  /** Names the pane in control labels: `Open <name> fullscreen` and `Close <name>`. */
  readonly name: string;
}): React.JSX.Element {
  const { chrome } = useThreePanels();
  return (
    <View testID={`${name} chrome`}>
      {chrome.toggleFullscreen === null ? null : (
        <Pressable
          accessibilityLabel={
            chrome.fullscreen ? `Exit ${name} fullscreen` : `Open ${name} fullscreen`
          }
          accessibilityRole="button"
          onPress={chrome.toggleFullscreen}
        >
          <Text>Fullscreen</Text>
        </Pressable>
      )}
      {chrome.close === null ? null : (
        <Pressable
          accessibilityLabel={`Close ${name}`}
          accessibilityRole="button"
          onPress={chrome.close}
        >
          <Text>Close</Text>
        </Pressable>
      )}
    </View>
  );
}
