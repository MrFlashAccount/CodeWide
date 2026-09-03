import { Ionicons } from "@expo/vector-icons";
import { useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type {
  DocumentLayoutMode,
  DocumentViewerPreferences,
} from "../../application/ports/documentViewerPreferenceStore";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { MAX_DOCUMENT_TEXT_SCALE, MIN_DOCUMENT_TEXT_SCALE } from "./documentViewerPreferences";

interface DocumentReaderActions {
  onChangeTextScale(delta: number): void;
  onResetTextScale(): void;
  onSetLayoutMode(mode: DocumentLayoutMode): void;
  preferences: DocumentViewerPreferences;
}

interface AttachmentPreviewHeaderProps {
  annotationEnabled: boolean;
  fileActionsEnabled: boolean;
  mediaType: string;
  name: string;
  onAnnotate(): void | Promise<void>;
  onClose(): void;
  onExport(): void | Promise<void>;
  onFailure(message: string, retry: () => void | Promise<void>): void;
  onSave(): void | Promise<void>;
  readerActions?: DocumentReaderActions;
}

interface HeaderActionProps {
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  onFailure(message: string, retry: () => void | Promise<void>): void;
  onPress(): void | Promise<void>;
}

export function AttachmentPreviewHeader(props: AttachmentPreviewHeaderProps): React.JSX.Element {
  const {
    annotationEnabled,
    fileActionsEnabled,
    mediaType,
    name,
    onAnnotate,
    onClose,
    onExport,
    onFailure,
    onSave,
    readerActions,
  } = props;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Close attachment"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.iconButton}
      >
        <Ionicons color={colors.text} name="close" size={23} />
      </Pressable>
      <View style={styles.titleBlock}>
        <Text numberOfLines={1} style={styles.title}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {mediaType === "" ? "Attachment" : mediaType}
        </Text>
      </View>
      {annotationEnabled ? (
        <HeaderAction
          accessibilityLabel="Annotate image"
          icon="brush-outline"
          onFailure={onFailure}
          onPress={onAnnotate}
        />
      ) : null}
      {fileActionsEnabled ? (
        <>
          <HeaderAction
            accessibilityLabel="Save attachment"
            icon="download-outline"
            onFailure={onFailure}
            onPress={onSave}
          />
          <HeaderAction
            accessibilityLabel="Open attachment in another app"
            icon="open-outline"
            onFailure={onFailure}
            onPress={onExport}
          />
        </>
      ) : null}
      {readerActions === undefined ? null : (
        <DocumentReaderMenu actions={readerActions} onDownload={onSave} onFailure={onFailure} />
      )}
    </View>
  );
}

interface DocumentReaderMenuProps {
  actions: DocumentReaderActions;
  onDownload(): void | Promise<void>;
  onFailure(message: string, retry: () => void | Promise<void>): void;
}

function DocumentReaderMenu(props: DocumentReaderMenuProps): React.JSX.Element {
  const { actions, onDownload, onFailure } = props;
  const { layoutMode, textScale } = actions.preferences;
  const items: readonly ActionMenuItem[] = [
    { icon: "download-outline", id: "download", label: "Download" },
    {
      disabled: textScale <= MIN_DOCUMENT_TEXT_SCALE,
      icon: "remove",
      id: "smaller",
      label: "Smaller",
      section: "Text size",
    },
    {
      icon: "refresh",
      id: "reset",
      label: `Reset to 100% (${Math.round(textScale * 100)}%)`,
      section: "Text size",
    },
    {
      disabled: textScale >= MAX_DOCUMENT_TEXT_SCALE,
      icon: "add",
      id: "larger",
      label: "Larger",
      section: "Text size",
    },
    {
      icon: "contract-outline",
      id: "reading",
      label: "Reading width",
      selected: layoutMode === "reading",
    },
    { icon: "expand-outline", id: "wide", label: "Full width", selected: layoutMode === "wide" },
  ];
  const select = useEvent((id: string): void => {
    if (id === "smaller") actions.onChangeTextScale(-0.1);
    else if (id === "reset") actions.onResetTextScale();
    else if (id === "larger") actions.onChangeTextScale(0.1);
    else if (id === "reading") actions.onSetLayoutMode("reading");
    else if (id === "wide") actions.onSetLayoutMode("wide");
    else if (id === "download") {
      Promise.resolve(onDownload()).catch((cause: unknown) =>
        onFailure(failureMessage(cause), onDownload),
      );
    }
  });
  return (
    <ActionMenu accessibilityLabel="Document reader actions" actions={items} onSelect={select}>
      <Pressable
        accessibilityLabel="Document reader actions"
        accessibilityRole="button"
        style={styles.iconButton}
      >
        <Ionicons color={colors.text} name="ellipsis-vertical" size={21} />
      </Pressable>
    </ActionMenu>
  );
}

function HeaderAction(props: HeaderActionProps): React.JSX.Element {
  const { accessibilityLabel, icon, onFailure, onPress } = props;
  const [pending, startTransition] = useTransition();
  const accessibilityState = { busy: pending, disabled: pending };
  const activate = useEvent((): void => {
    if (pending) return;
    startTransition(async () => {
      try {
        await onPress();
      } catch (cause) {
        onFailure(failureMessage(cause), onPress);
      }
    });
  });
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={pending}
      onPress={activate}
      style={styles.iconButton}
    >
      {pending ? (
        <ShimmerText style={styles.pending} text="•••" />
      ) : (
        <Ionicons color={colors.text} name={icon} size={21} />
      )}
    </Pressable>
  );
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Attachment action failed. Try again.";
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pending: { ...typeScale.caption },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  title: { color: colors.text, ...typeScale.title },
  titleBlock: { flex: 1, minWidth: 0 },
});
