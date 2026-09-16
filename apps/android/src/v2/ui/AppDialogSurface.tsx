import { AppButton as Button } from "../../presentation/controls/AppButton";
import { StyleSheet, View } from "react-native";

import { AppModalDialog } from "../../presentation/overlay/AppModalDialog";
import { useEvent } from "../../react/useEvent";
import { colors, spacing, typeScale } from "../theme";
import { ProductText as Text } from "../presentation/text/ProductText";
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
  return (
    <AppModalDialog contentStyle={styles.content} onDismiss={onDismiss} open={isOpen}>
      {request === null ? null : (
        <>
          <View style={styles.copy}>
            <Text style={styles.title}>{request.title}</Text>
            {request.message === undefined ? null : (
              <Text style={styles.message}>{request.message}</Text>
            )}
          </View>
          <View style={styles.actions}>
            {request.actions.map((action) => (
              <DialogActionButton action={action} key={action.text} onAction={onAction} />
            ))}
          </View>
        </>
      )}
    </AppModalDialog>
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
    gap: spacing.lg,
  },
  copy: {
    gap: spacing.xs,
    paddingRight: spacing.xxs,
  },
  message: { color: colors.textMuted, ...typeScale.body },
  title: { color: colors.text, ...typeScale.title },
});
