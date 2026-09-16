import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ContentReviewKeyboardDock } from "../../../rendering/ContentReviewKeyboardDock";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { AppText } from "../../../ui/Typography";
import { searchComposerTrialMentions } from "./composer-editor-trial";
import { ComposerMentionInput } from "./ComposerMentionInput.native";

type TrialProps = { readonly onClose: () => void };

/** Local editor evaluation only. There is deliberately no send or draft binding. */
export default function ComposerEditorTrial(props: TrialProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <AppText style={styles.title}>Markdown composer · Trial</AppText>
        <Pressable
          accessibilityLabel="Close composer trial"
          accessibilityRole="button"
          onPress={props.onClose}
          style={styles.close}
        >
          <AppText style={styles.text}>Close</AppText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="always"
        style={styles.body}
      >
        <AppText style={styles.hint}>
          Try / for skills or @ for context. Select text for Format; + inserts blocks and lists.
          Three backticks and Enter opens code. Enter adds code lines. Tap above or below the block
          to leave it.
        </AppText>
        {markdown !== null ? (
          <View style={styles.preview}>
            <AppText style={styles.hint}>Markdown preview · tap ↑ again after editing</AppText>
            <AppText selectable style={styles.text}>
              {markdown === "" ? "(empty)" : markdown}
            </AppText>
          </View>
        ) : null}
      </ScrollView>
      <ContentReviewKeyboardDock>
        <AppText style={styles.notice}>Local trial · ↑ previews Markdown, nothing is sent</AppText>
        <ComposerMentionInput
          defaultValue=""
          onPreviewMarkdown={setMarkdown}
          search={searchComposerTrialMentions}
        />
      </ContentReviewKeyboardDock>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  bodyContent: {
    gap: spacing.md,
    paddingBottom: controlSize.touch * 4,
    paddingHorizontal: spacing.md,
  },
  close: {
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.md,
  },
  hint: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  notice: {
    ...typeScale.caption,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  preview: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  text: {
    ...typeScale.body,
    color: colors.text,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    flex: 1,
  },
});
