import { colors, controlSize, spacing, typeScale } from "../theme";
import { AppButton as Button } from "../presentation/controls/AppButton";
import { StyleSheet, View } from "react-native";

import { AppModalDialog } from "../presentation/overlay/AppModalDialog";
import { useEvent } from "../react/useEvent";
import type { AppDialogAction, AppDialogSurfaceProps } from "./AppDialog.types";
import { AppText as Text } from "./AppText";
import { CopyErrorButton } from "./CopyErrorButton";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

/** Renders the native implementation of the application confirmation dialog. */
export function AppDialogSurface({ isOpen, onAction, onDismiss, request }: AppDialogSurfaceProps) {
  return (
    <RecoverableRenderBoundary
      label="Confirmation dialog"
      onDismiss={onDismiss}
      resetKey={request?.title ?? "closed"}
      scope="dialog"
    >
      <AppModalDialog contentStyle={styles.content} onDismiss={onDismiss} open={isOpen}>
        {request !== null && (
          <>
            <View style={styles.copy}>
              <Text style={styles.title}>{request.title}</Text>
              {request.message !== undefined && (
                <Text style={styles.message}>{request.message}</Text>
              )}
            </View>
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
          </>
        )}
      </AppModalDialog>
    </RecoverableRenderBoundary>
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
    <Button
      onPress={activate}
      size="sm"
      style={styles.button}
      variant={
        action.style === "destructive" ? "danger" : action.style === "cancel" ? "ghost" : "primary"
      }
    >
      {action.text}
    </Button>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.inputInset,
    justifyContent: "flex-end",
  },
  button: {
    minHeight: controlSize.regular,
    minWidth: controlSize.regular,
  },
  content: {
    gap: spacing.lg,
  },
  copy: {
    gap: spacing.xs,
    paddingRight: spacing.xxs,
  },
  message: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
});
