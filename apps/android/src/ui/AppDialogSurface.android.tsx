import { BasicAlertDialog, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import type { AppDialogAction, AppDialogSurfaceProps } from "./AppDialog.types";
import { AppText as Text } from "./AppText";
import { CopyErrorButton } from "./CopyErrorButton";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

/** Android dialogs must own a window: a root portal is below fullscreen and sheet windows. */
export function AppDialogSurface({ isOpen, onAction, onDismiss, request }: AppDialogSurfaceProps) {
  const { height, width } = useWindowDimensions();
  if (!isOpen || request === null) {
    return null;
  }
  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <BasicAlertDialog
        onDismissRequest={onDismiss}
        properties={{ usePlatformDefaultWidth: false }}
      >
        <RNHostView matchContents>
          <RecoverableRenderBoundary
            label="Confirmation dialog"
            onDismiss={onDismiss}
            scope="dialog"
          >
            <View
              style={[
                styles.content,
                {
                  maxHeight: Math.max(controlSize.touch, height - spacing.md * 2),
                  width: Math.min(420, Math.max(0, width - spacing.md * 2)),
                },
              ]}
              testID="app-dialog-window-content"
            >
              <ScrollView contentContainerStyle={styles.copyContent} style={styles.copy}>
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
                {request.actions.map((action) => (
                  <DialogActionButton
                    action={action}
                    key={`${action.style ?? "default"}:${action.text}`}
                    onAction={onAction}
                  />
                ))}
              </View>
            </View>
          </RecoverableRenderBoundary>
        </RNHostView>
      </BasicAlertDialog>
    </Host>
  );
}

function DialogActionButton({
  action,
  onAction,
}: {
  readonly action: AppDialogAction;
  readonly onAction: (action: AppDialogAction) => void;
}): React.JSX.Element {
  const activate = useEvent(() => {
    onAction(action);
  });
  return (
    <Pressable accessibilityRole="button" onPress={activate} style={styles.button}>
      <Text style={[styles.buttonText, action.style === "destructive" && styles.destructive]}>
        {action.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  buttonText: {
    color: colors.primary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  content: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    gap: spacing.md,
    padding: spacing.md,
  },
  copy: { flexShrink: 1 },
  copyContent: { gap: spacing.sm },
  destructive: { color: colors.red },
  message: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
});
