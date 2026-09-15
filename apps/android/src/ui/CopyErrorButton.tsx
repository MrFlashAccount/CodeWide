import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, spacing, typeScale } from "../theme";
import { AppText as Text } from "./AppText";

export function CopyErrorButton({ report }: { report: string }) {
  const inFlight = useRef(false);
  const [status, setStatus] = useState<"ready" | "copying" | "copied" | "failed">("ready");
  const copy = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("copying");
    let copied = false;
    try {
      copied = await Clipboard.setStringAsync(report);
    } catch {
      setStatus("failed");
      inFlight.current = false;
      return;
    }
    setStatus(copied ? "copied" : "failed");
    inFlight.current = false;
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy error"
        disabled={status === "copying"}
        onPress={() => void copy()}
        style={styles.button}
      >
        <Text style={styles.label}>
          {status === "copied" ? "Copied" : status === "copying" ? "Copying…" : "Copy error"}
        </Text>
      </Pressable>
      <Text style={styles.hint}>
        {status === "failed"
          ? "Could not copy. Tap to retry."
          : "May contain private paths. Review before sharing."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: controlSize.touch,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  label: {
    color: colors.primary,
    ...typeScale.body,
  },
  hint: {
    color: colors.textMuted,
    ...typeScale.label,
  },
});
