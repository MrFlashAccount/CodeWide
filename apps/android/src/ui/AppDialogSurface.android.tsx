import { BasicAlertDialog, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import type { AppDialogSurfaceProps } from "./AppDialog.types";
import { CopyErrorButton } from "./CopyErrorButton";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";
import { AppText as Text } from "./Typography";

/** Android dialogs must own a window: a root portal is below fullscreen and sheet windows. */
export function AppDialogSurface({ isOpen, request, onDismiss, onAction }: AppDialogSurfaceProps) {
  const { width, height } = useWindowDimensions();
  if (!isOpen || request === null) return null;
  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <BasicAlertDialog
        onDismissRequest={onDismiss}
        properties={{ usePlatformDefaultWidth: false }}
      >
        <RNHostView matchContents>
          <RecoverableRenderBoundary
            scope="dialog"
            label="Confirmation dialog"
            onDismiss={onDismiss}
          >
            <View
              testID="app-dialog-window-content"
              style={[
                styles.content,
                {
                  width: Math.min(420, Math.max(0, width - spacing.md * 2)),
                  maxHeight: Math.max(controlSize.touch, height - spacing.md * 2),
                },
              ]}
            >
              <ScrollView style={styles.copy} contentContainerStyle={styles.copyContent}>
                <Text accessibilityRole="header" style={styles.title}>
                  {request.title}
                </Text>
                {request.message !== undefined && (
                  <Text selectable style={styles.message}>
                    {request.message}
                  </Text>
                )}
              </ScrollView>
              {request.diagnostic !== undefined && (
                <CopyErrorButton key={request.diagnostic} report={request.diagnostic} />
              )}
              <View style={styles.actions}>
                {request.actions.map((action, index) => (
                  <Pressable
                    key={`${action.text}-${index}`}
                    accessibilityRole="button"
                    onPress={() => onAction(action)}
                    style={styles.button}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        action.style === "destructive" && styles.destructive,
                      ]}
                    >
                      {action.text}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </RecoverableRenderBoundary>
        </RNHostView>
      </BasicAlertDialog>
    </Host>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    padding: spacing.md,
    gap: spacing.md,
  },
  copy: { flexShrink: 1 },
  copyContent: { gap: spacing.sm },
  title: {
    color: colors.text,
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
  message: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  button: {
    minWidth: controlSize.touch,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    color: colors.primary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  destructive: { color: colors.red },
});
