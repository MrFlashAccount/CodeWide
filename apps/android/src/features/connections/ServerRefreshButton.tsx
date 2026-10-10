import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, iconSize, touchTarget } from "../../theme";

/**
 * Refreshes everything the server page shows in one intent: its account pool,
 * provider list (sign-ins and limits) and software update status. Each read
 * keeps its result and error with its own owner; the button only shows that
 * the reads are running.
 */
export function ServerRefreshButton({
  refreshes,
  serverName,
}: {
  readonly refreshes: readonly (() => Promise<void>)[];
  readonly serverName: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const refresh = useEvent(() => {
    if (busy) {
      return;
    }
    setBusy(true);
    const settled = (): void => {
      setBusy(false);
    };
    // `allSettled` never rejects; the second handler only satisfies the promise contract.
    Promise.allSettled(refreshes.map(async (read) => read())).then(settled, settled);
  });
  return (
    <Pressable
      accessibilityLabel={`Refresh ${serverName}`}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={refresh}
      style={styles.button}
      testID="server-refresh"
    >
      {busy ? (
        <ActivityIndicator color={colors.textMuted} size="small" />
      ) : (
        <Ionicons color={colors.text} name="refresh" size={iconSize.action} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
