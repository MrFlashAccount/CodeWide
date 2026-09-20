import {
  AlertDialog,
  BasicAlertDialog,
  Host,
  RNHostView,
  Text as ComposeText,
  TextButton,
} from "@expo/ui/jetpack-compose";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import type { AppDialogAction, AppDialogSurfaceProps } from "./AppDialog.types";
import { AppText as Text } from "./AppText";
import { CopyErrorButton } from "./CopyErrorButton";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

const CUSTOM_DIALOG_MAX_WIDTH = 420;
const MATERIAL_DIALOG_MAX_ACTIONS = 2;
const MATERIAL_MESSAGE_STYLE = {
  lineHeight: typeScale.body.lineHeight,
  typography: "bodyMedium",
} as const;
const MATERIAL_TITLE_STYLE = {
  fontWeight: typeWeight.semibold,
  typography: "titleLarge",
} as const;

/** Android dialogs must own a window: a root portal is below fullscreen and sheet windows. */
export function AppDialogSurface({ isOpen, onAction, onDismiss, request }: AppDialogSurfaceProps) {
  if (!isOpen || request === null) {
    return null;
  }
  return <VisibleAppDialog onAction={onAction} onDismiss={onDismiss} request={request} />;
}

function VisibleAppDialog({
  onAction,
  onDismiss,
  request,
}: Omit<AppDialogSurfaceProps, "isOpen" | "request"> & {
  readonly request: NonNullable<AppDialogSurfaceProps["request"]>;
}): React.JSX.Element {
  const { height, width } = useWindowDimensions();
  const materialActions = resolveMaterialActions(request.actions);
  if (request.diagnostic === undefined && materialActions !== null) {
    return (
      <MaterialAppDialog
        actions={materialActions}
        message={request.message}
        onAction={onAction}
        onDismiss={onDismiss}
        title={request.title}
        width={width}
      />
    );
  }
  return (
    <CustomAppDialog
      height={height}
      onAction={onAction}
      onDismiss={onDismiss}
      request={request}
      width={width}
    />
  );
}

function CustomAppDialog({
  height,
  onAction,
  onDismiss,
  request,
  width,
}: Omit<AppDialogSurfaceProps, "isOpen" | "request"> & {
  readonly height: number;
  readonly request: NonNullable<AppDialogSurfaceProps["request"]>;
  readonly width: number;
}): React.JSX.Element {
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
                  width: Math.min(CUSTOM_DIALOG_MAX_WIDTH, Math.max(0, width - spacing.md * 2)),
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

function MaterialAppDialog({
  actions,
  message,
  onAction,
  onDismiss,
  title,
  width,
}: {
  readonly actions: MaterialDialogActions;
  readonly message: string | undefined;
  readonly onAction: (action: AppDialogAction) => void;
  readonly onDismiss: () => void;
  readonly title: string;
  readonly width: number;
}): React.JSX.Element {
  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <AlertDialog
        colors={{
          containerColor: colors.surfaceContainerHigh,
          textContentColor: colors.textMuted,
          titleContentColor: colors.text,
        }}
        onDismissRequest={onDismiss}
      >
        <MaterialDialogTitle title={title} />
        <MaterialDialogMessage message={message} />
        <MaterialDialogActionsContent actions={actions} onAction={onAction} />
      </AlertDialog>
    </Host>
  );
}

function MaterialDialogTitle({ title }: { readonly title: string }): React.JSX.Element {
  return (
    <AlertDialog.Title>
      <ComposeText style={MATERIAL_TITLE_STYLE}>{title}</ComposeText>
    </AlertDialog.Title>
  );
}

function MaterialDialogMessage({
  message,
}: {
  readonly message: string | undefined;
}): React.JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <AlertDialog.Text>
      <ComposeText style={MATERIAL_MESSAGE_STYLE}>{message}</ComposeText>
    </AlertDialog.Text>
  );
}

function MaterialDialogActionsContent({
  actions,
  onAction,
}: {
  readonly actions: MaterialDialogActions;
  readonly onAction: (action: AppDialogAction) => void;
}): React.JSX.Element {
  return (
    <>
      <AlertDialog.ConfirmButton>
        <MaterialDialogAction action={actions.confirm} onAction={onAction} />
      </AlertDialog.ConfirmButton>
      {actions.dismiss !== null && (
        <AlertDialog.DismissButton>
          <MaterialDialogAction action={actions.dismiss} onAction={onAction} />
        </AlertDialog.DismissButton>
      )}
    </>
  );
}

function MaterialDialogAction({
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
    <TextButton
      colors={{ contentColor: action.style === "destructive" ? colors.red : colors.primary }}
      onClick={activate}
    >
      <ComposeText>{action.text}</ComposeText>
    </TextButton>
  );
}

type MaterialDialogActions = {
  readonly confirm: AppDialogAction;
  readonly dismiss: AppDialogAction | null;
};

function resolveMaterialActions(actions: readonly AppDialogAction[]): MaterialDialogActions | null {
  const confirm = actions.find((action) => action.style !== "cancel") ?? null;
  const dismiss = actions.find((action) => action.style === "cancel") ?? null;
  if (
    confirm === null ||
    actions.length > MATERIAL_DIALOG_MAX_ACTIONS ||
    actions.some((action) => action !== confirm && action !== dismiss)
  ) {
    return null;
  }
  return { confirm, dismiss };
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
