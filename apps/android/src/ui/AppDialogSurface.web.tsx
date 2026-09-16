import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, typeScale, controlSize } from "../theme";
import type { AppDialogAction, AppDialogSurfaceProps } from "./AppDialog.types";
import { AppText as Text } from "./AppText";
import { CopyErrorButton } from "./CopyErrorButton";
import { AppSheet } from "./AppSheet";

/** Renders the web implementation of the application confirmation dialog. */
export function AppDialogSurface({ isOpen, onAction, onDismiss, request }: AppDialogSurfaceProps) {
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onDismiss();
    }
  });
  return (
    <AppSheet
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen={isOpen}
      onOpenChange={changeOpen}
    >
      {request !== null && (
        <View style={styles.content}>
          <Text style={styles.title}>{request.title}</Text>
          {request.message !== undefined && (
            <Text style={styles.description}>{request.message}</Text>
          )}
          <View style={styles.actions}>
            {request.diagnostic !== undefined && (
              <CopyErrorButton key={request.diagnostic} report={request.diagnostic} />
            )}
            {request.actions.map((action) => (
              <DialogActionButton
                action={action}
                key={`${action.style ?? "default"}:${action.text}`}
                onAction={onAction}
              />
            ))}
          </View>
        </View>
      )}
    </AppSheet>
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
    <Pressable
      onPress={activate}
      style={[styles.button, action.style === "destructive" && styles.dangerButton]}
    >
      <Text style={[styles.buttonLabel, action.style === "destructive" && styles.dangerLabel]}>
        {action.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.sm,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.regular,
    minWidth: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  buttonLabel: {
    color: colors.text,
    fontFamily: "RobotoFlex-Medium",
  },
  content: { gap: spacing.sm },
  dangerButton: { backgroundColor: colors.red },
  dangerLabel: { color: colors.onPrimary },
  description: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    ...typeScale.heading,
    fontFamily: "RobotoFlex-SemiBold",
  },
});
