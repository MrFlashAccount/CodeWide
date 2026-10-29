import { Pressable, Text, View } from "react-native";

import type { WorkspacePaneChrome } from "../../src/routeComposition/workspacePanes";

/**
 * Renders a pane's layout-resolved chrome the way a pane header does: one button per declared
 * menu item and the pane's close, so route tests can drive pane actions without the conversation.
 */
export function PaneChromeControls({
  chrome,
  name,
}: {
  readonly chrome: WorkspacePaneChrome;
  /** Names the pane in control labels: `<name> menu: <item>` and `Close <name>`. */
  readonly name: string;
}): React.JSX.Element {
  return (
    <View testID={`${name} chrome`}>
      {chrome.menuItems.map((item) => (
        <Pressable
          accessibilityLabel={`${name} menu: ${item.label}`}
          accessibilityRole="button"
          key={item.id}
          onPress={item.onSelect}
        >
          <Text>{item.label}</Text>
        </Pressable>
      ))}
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
