import { useState, useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { PresentationSheetView } from "../../presentation/surfaces/PresentationSheetView";
import { ProductText } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { VoiceTextInput } from "./VoiceTextInput";

interface ConversationRenameSheetProps {
  live: boolean;
  onClose(): void;
  owner: QualifiedThread;
  title: string;
}

export function ConversationRenameSheet(props: ConversationRenameSheetProps): React.JSX.Element {
  const { live, onClose, owner, title } = props;
  const runtime = useV2Runtime();
  const [pending, startRename] = useTransition();
  const [renameTitle, setRenameTitle] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const changeVisibility = useEvent((visible: boolean) => {
    if (pending || visible) return;
    setError(null);
    onClose();
  });
  const submit = useEvent(() => {
    const normalized = renameTitle.trim();
    if (normalized === "" || pending || !live) return;
    setError(null);
    startRename(() =>
      runtime.commandActivations
        .execute(owner.savedServerId, {
          change: { kind: "title", title: normalized },
          kind: "thread.update",
          threadId: owner.threadId,
        })
        .then(
          (frame) => {
            if (frame.type !== "commandCompleted") {
              setError(frame.error.message);
              return;
            }
            onClose();
          },
          (cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not rename this thread.");
          },
        ),
    );
  });
  return (
    <PresentationSheetView contentProps={{ index: 0 }} isOpen onOpenChange={changeVisibility}>
      <View style={styles.content}>
        <ProductText style={styles.heading} weight="semibold">
          Rename thread
        </ProductText>
        <ProductText style={styles.label} tone="muted">
          Name
        </ProductText>
        <VoiceTextInput
          accessibilityLabel="Thread name"
          audience={owner.savedServerId}
          editable={!pending}
          onChangeText={setRenameTitle}
          onSubmitEditing={submit}
          scope={{ id: `thread-rename:${owner.threadId}`, kind: "generic" }}
          selectTextOnFocus
          style={styles.input}
          thread={owner}
          value={renameTitle}
        />
        <Pressable
          accessibilityLabel="Rename thread"
          accessibilityRole="button"
          accessibilityState={{ busy: pending, disabled: renameTitle.trim() === "" }}
          disabled={pending || renameTitle.trim() === ""}
          onPress={submit}
          style={styles.button}
        >
          {pending ? (
            <ShimmerText style={styles.buttonText} text="Renaming" />
          ) : (
            <ProductText style={styles.buttonText} weight="semibold">
              Rename
            </ProductText>
          )}
        </Pressable>
        {error === null ? null : (
          <ProductText accessibilityRole="alert" selectable style={styles.error}>
            {error}
          </ProductText>
        )}
      </View>
    </PresentationSheetView>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  buttonText: { color: colors.background, ...typeScale.body },
  content: { gap: spacing.xs, paddingBottom: spacing.sm },
  error: { color: colors.red, ...typeScale.label },
  heading: typeScale.heading,
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  label: typeScale.label,
});
