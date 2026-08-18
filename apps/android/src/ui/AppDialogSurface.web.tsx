import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import type { AppDialogSurfaceProps } from "./AppDialog.types";
import { AppSheet } from "./AppSheet";
import { AppText as Text } from "./Typography";

export function AppDialogSurface({ isOpen, request, onDismiss, onAction }: AppDialogSurfaceProps) {
  return (
    <AppSheet isOpen={isOpen} onOpenChange={(open) => { if (!open) onDismiss(); }} contentProps={{ index: 0, enableDynamicSizing: true }}>
      {request !== null && (
        <View style={styles.content}>
          <Text style={styles.title}>{request.title}</Text>
          {request.message !== undefined && <Text style={styles.description}>{request.message}</Text>}
          <View style={styles.actions}>
            {request.actions.map((action, index) => (
              <Pressable
                key={`${action.text}-${index}`}
                onPress={() => onAction(action)}
                style={[styles.button, action.style === "destructive" && styles.dangerButton]}
              >
                <Text style={[styles.buttonLabel, action.style === "destructive" && styles.dangerLabel]}>{action.text}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm },
  title: { color: colors.text, fontSize: 20, lineHeight: 26, fontFamily: "RobotoFlex-SemiBold" },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  button: { minWidth: 88, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.large, backgroundColor: colors.surfaceContainerHigh },
  dangerButton: { backgroundColor: colors.red },
  buttonLabel: { color: colors.text, fontFamily: "RobotoFlex-Medium" },
  dangerLabel: { color: colors.onPrimary },
});
