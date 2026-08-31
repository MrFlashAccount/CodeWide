import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { Action } from "./action";
import { useActionRunner } from "./ActionRunner";

export function ActionPressable({ action }: { action: Action }): React.JSX.Element {
  const runner = useActionRunner();
  const pending = runner.active === action.id;
  const failure = runner.failures[action.id];
  return (
    <View>
      <Pressable
        accessibilityLabel={action.label}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: action.disabled === true || pending }}
        disabled={action.disabled === true || pending}
        onPress={() => {
          runner.run(action);
        }}
      >
        {pending ? (
          <ActivityIndicator accessibilityLabel={`${action.label} in progress`} />
        ) : (
          <Text>{action.label}</Text>
        )}
      </Pressable>
      {failure === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {failure}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: "#ff8b8b", marginTop: 4 },
});
