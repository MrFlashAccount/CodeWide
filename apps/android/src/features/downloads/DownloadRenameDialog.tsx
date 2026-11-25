import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";
import type { DownloadManager } from "../../data/downloadManager";
import type { DownloadEntry } from "../../data/downloadRecords";
import { AppModalDialog } from "../../presentation/overlay/AppModalDialog";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { AppText, AppTextInput } from "../../ui/Typography";
import { styles } from "./DownloadsSheet.styles";

/** Edits the local name, keeping the input available after a provider error. */
export function DownloadRenameDialog({
  entry,
  manager,
  onClose,
}: {
  readonly entry: DownloadEntry;
  readonly manager: DownloadManager;
  readonly onClose: () => void;
}): React.JSX.Element {
  const draft = useConstant(() => observable({ error: "", name: entry.name, pending: false }));
  const { error, name, pending } = useSelector(() => draft.get());
  const change = useEvent((value: string) => {
    draft.name.set(value);
    draft.error.set("");
  });
  const dismiss = useEvent(() => {
    if (!draft.pending.peek()) {
      onClose();
    }
  });
  const disabled = pending || name.trim() === "" || name.trim() === entry.name;
  const save = useEvent(() => {
    if (disabled || draft.pending.peek()) {
      return;
    }
    draft.pending.set(true);
    manager.renameFile(entry.id, draft.name.peek()).then(onClose, (error: unknown) => {
      draft.pending.set(false);
      draft.error.set(error instanceof Error ? error.message : "Could not rename file");
    });
  });
  return (
    <AppModalDialog dismissOnBackdrop={!pending} onDismiss={dismiss} open>
      <AppText accessibilityRole="header" style={styles.formTitle}>
        Rename file
      </AppText>
      <AppTextInput
        accessibilityLabel="File name"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!pending}
        onChangeText={change}
        onSubmitEditing={save}
        returnKeyType="done"
        selectTextOnFocus
        style={styles.nameInput}
        value={name}
        voiceInput={false}
      />
      {error !== "" && (
        <AppText accessibilityRole="alert" style={styles.error}>
          {error}
        </AppText>
      )}
      <RenameActions disabled={disabled} dismiss={dismiss} pending={pending} save={save} />
    </AppModalDialog>
  );
}

function RenameActions({
  disabled,
  dismiss,
  pending,
  save,
}: {
  readonly disabled: boolean;
  readonly dismiss: () => void;
  readonly pending: boolean;
  readonly save: () => void;
}) {
  return (
    <View style={styles.formActions}>
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={dismiss}
        style={styles.formButton}
      >
        <AppText style={styles.notice}>Cancel</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled }}
        disabled={disabled}
        onPress={save}
        style={styles.formButton}
      >
        <AppText shimmering={pending} style={[styles.formTitle, disabled && styles.dim]}>
          Rename
        </AppText>
      </Pressable>
    </View>
  );
}
