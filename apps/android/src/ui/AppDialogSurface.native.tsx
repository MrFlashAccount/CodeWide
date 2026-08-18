import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { StyleSheet, View } from "react-native";

import type { AppDialogSurfaceProps } from "./AppDialog.types";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

export function AppDialogSurface({ isOpen, request, onDismiss, onAction }: AppDialogSurfaceProps) {
  return (
    <RecoverableRenderBoundary scope="dialog" label="Confirmation dialog" resetKey={request?.title ?? "closed"} onDismiss={onDismiss}>
    <Dialog isOpen={isOpen} onOpenChange={(open) => {
      if (!open) onDismiss();
    }}>
      <Dialog.Portal style={styles.portal}>
        <Dialog.Overlay variant="blur" blurViewProps={{ intensity: 34 }} />
        {request !== null && (
          <Dialog.Content style={styles.content}>
            <View style={styles.copy}>
              <Dialog.Title>{request.title}</Dialog.Title>
              {request.message !== undefined && (
                <Dialog.Description>{request.message}</Dialog.Description>
              )}
            </View>
            <View style={styles.actions}>
              {request.actions.map((action, index) => (
                <Button
                  key={`${action.text}-${index}`}
                  size="sm"
                  variant={action.style === "destructive"
                    ? "danger"
                    : action.style === "cancel"
                      ? "ghost"
                      : "primary"}
                  onPress={() => onAction(action)}
                  style={styles.button}
                >
                  {action.text}
                </Button>
              ))}
            </View>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog>
    </RecoverableRenderBoundary>
  );
}

const styles = StyleSheet.create({
  portal: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  content: {
    alignSelf: "center",
    gap: 22,
    maxWidth: 420,
    width: "92%",
  },
  copy: {
    gap: 7,
    paddingRight: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  button: {
    minWidth: 88,
  },
});
