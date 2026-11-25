import type { FileCommentTarget } from "./fileReading";
import { randomUUID } from "expo-crypto";
import { useSelector } from "@legendapp/state/react";
import { StyleSheet, TextInput, View } from "react-native";

import { newDraftId } from "../../../data/reviewContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { KeyboardDock } from "../../../ui/KeyboardDock";
import { useAndroidBackHandler } from "../../../ui/use-android-back-handler";
import type { PullRequestChangesProps } from "./changesContract";

/** Publishes the local draft into the same review queue as line comments. */
export function FileCommentForm({
  close,
  screen,
  target,
}: {
  readonly close: () => void;
  readonly screen: PullRequestChangesProps;
  readonly target: FileCommentTarget;
}): React.JSX.Element {
  const id = useConstant(() => target.id ?? newDraftId(randomUUID()));
  const body = useSelector(target.body);
  const setBody = useEvent((value: string) => {
    target.body.set(value);
  });
  useAndroidBackHandler(true, close);
  const add = useEvent(() => {
    if (body.trim() === "") {
      return;
    }
    void screen.reviewCapabilities
      .putDraft(
        screen.connectionId,
        {
          anchor: { kind: "file", path: target.path },
          body,
          destination: "pr",
          id,
          revision: {
            revision: target.revision,
            source: { kind: "pullRequest", pullRequest: screen.overview.pullRequest },
          },
        },
        null,
      )
      .catch(() => undefined);
    close();
  });
  return (
    <KeyboardDock>
      <View style={styles.form}>
        <Text numberOfLines={2} style={styles.title}>
          {target.path}
        </Text>
        <TextInput
          accessibilityLabel={`Comment on file ${target.path}`}
          multiline
          onChangeText={setBody}
          placeholder="Comment on this file…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={body}
        />
        <FileCommentActions add={add} close={close} empty={body.trim() === ""} />
      </View>
    </KeyboardDock>
  );
}
function FileCommentActions({
  add,
  close,
  empty,
}: {
  readonly add: () => void;
  readonly close: () => void;
  readonly empty: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.actions}>
      <AppButton onPress={close} variant="ghost">
        Cancel
      </AppButton>
      <AppButton isDisabled={empty} onPress={add}>
        Add to review
      </AppButton>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  form: {
    backgroundColor: colors.surfaceContainer,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    minHeight: controlSize.regular,
  },
  title: {
    ...typeScale.label,
    color: colors.textMuted,
  },
});
