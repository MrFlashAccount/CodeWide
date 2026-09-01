import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { spacing } from "../theme";
import type { AppDialogAction, AppDialogSurfaceProps } from "./AppDialog.types";

interface DialogActionButtonProps {
  action: AppDialogAction;
  onAction(action: AppDialogAction): void;
}

function DialogActionButton(props: DialogActionButtonProps): React.JSX.Element {
  const { action, onAction } = props;
  const press = useEvent(() => onAction(action));
  const variant =
    action.style === "destructive" ? "danger" : action.style === "cancel" ? "ghost" : "primary";
  return (
    <Button onPress={press} size="sm" style={styles.button} variant={variant}>
      {action.text}
    </Button>
  );
}

export function AppDialogSurface(props: AppDialogSurfaceProps): React.JSX.Element {
  const { isOpen, onAction, onDismiss, request } = props;
  const openChange = useEvent((open: boolean) => {
    if (!open) onDismiss();
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={openChange}>
      <Dialog.Portal style={styles.portal}>
        <Dialog.Overlay blurViewProps={{ intensity: 34 }} variant="blur" />
        {request === null ? null : (
          <Dialog.Content style={styles.content}>
            <View style={styles.copy}>
              <Dialog.Title>{request.title}</Dialog.Title>
              {request.message === undefined ? null : (
                <Dialog.Description>{request.message}</Dialog.Description>
              )}
            </View>
            <View style={styles.actions}>
              {request.actions.map((action) => (
                <DialogActionButton action={action} key={action.text} onAction={onAction} />
              ))}
            </View>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  button: {
    minWidth: 88,
  },
  content: {
    alignSelf: "center",
    gap: spacing.lg,
    maxWidth: 420,
    width: "92%",
  },
  copy: {
    gap: spacing.xs,
    paddingRight: spacing.xxs,
  },
  portal: {
    alignItems: "center",
    inset: 0,
    justifyContent: "center",
    padding: spacing.md,
    position: "absolute",
  },
});
