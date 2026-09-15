import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, iconSize, radii, spacing, touchTarget, typeScale } from "../../../theme";
import { CodeWideMenu, type CodeWideMenuAction } from "../../../ui/CodeWideMenu";
import { productFonts } from "../../../ui/product-fonts";
import { AppText } from "../../../ui/Typography";
import { ComposerMarkdownInput } from "./ComposerMarkdownInput";
import type { ComposerMarkdownInputHandle } from "./ComposerMarkdownInput.types";
import type { ComposerMentionInputProps } from "./ComposerMentionInput.types";

const indicators = ["/", "@"] as const;
const insertActions = [
  { id: "codeBlock", label: "Code block", icon: "code-slash-outline" },
  { id: "list", label: "Bulleted list", icon: "list-outline" },
  { id: "orderedList", label: "Numbered list", icon: "list-outline" },
  { id: "skills", label: "Skills", icon: "sparkles-outline" },
  { id: "context", label: "Context", icon: "at-outline" },
] satisfies readonly CodeWideMenuAction[];
// Match V1's 48–132 dp envelope without mirroring native text measurements in JS.
const maximumInputHeight = touchTarget + typeScale.composerInput.lineHeight * 4;

/** Standalone native editor: no draft persistence, delivery, server ownership, or wire conversion. */
export function ComposerMentionInput(props: ComposerMentionInputProps) {
  const input = useRef<ComposerMarkdownInputHandle>(null);
  const [reading, startReading] = useTransition();
  const [readError, setReadError] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dismissTools = () => setToolsOpen(false);
  const insert = (id: string) => {
    setToolsOpen(false);
    input.current?.focus();
    switch (id) {
      case "codeBlock":
        input.current?.insertCode(true);
        break;
      case "list":
        input.current?.toggleUnorderedList();
        break;
      case "orderedList":
        input.current?.toggleOrderedList();
        break;
      case "skills":
        input.current?.startMention("/");
        break;
      case "context":
        input.current?.startMention("@");
        break;
    }
  };
  function toggleTools() {
    setToolsOpen(!toolsOpen);
  }
  function preview() {
    if (reading) return;
    startReading(async () => {
      setReadError(false);
      try {
        const editor = input.current;
        if (editor === null) return;
        const markdown = await editor.getMarkdown();
        if (mounted.current) props.onPreviewMarkdown(markdown);
      } catch {
        if (mounted.current) setReadError(true);
      }
    });
  }

  return (
    <View style={styles.container}>
      {readError ? (
        <AppText accessibilityRole="alert" style={styles.error}>
          Could not read Markdown. Try again.
        </AppText>
      ) : null}
      <View style={styles.row}>
        <View style={styles.inputShell}>
          <CodeWideMenu
            actions={insertActions}
            expanded={toolsOpen}
            onDismiss={dismissTools}
            onSelect={insert}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Composer tools"
              accessibilityState={{ expanded: toolsOpen }}
              onPress={toggleTools}
              style={styles.menu}
            >
              <Ionicons name="add" size={iconSize.navigation} color={colors.text} />
            </Pressable>
          </CodeWideMenu>
          <ComposerMarkdownInput
            ref={input}
            accessibilityLabel="Message Codex"
            value={value}
            placeholder="Message Codex…"
            style={styles.input}
            mentionIndicators={indicators}
            search={props.search}
            onChangeText={setValue}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Preview Markdown"
          accessibilityHint="Shows Markdown locally. Does not send a message."
          accessibilityState={{ disabled: reading, busy: reading }}
          disabled={reading}
          onPress={preview}
          style={styles.previewButton}
        >
          {reading ? (
            <AppText style={styles.previewPending}>…</AppText>
          ) : (
            <Ionicons name="arrow-up" size={iconSize.navigation} color={colors.onPrimary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
    minHeight: 0,
    minWidth: 0,
    alignSelf: "stretch",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.compact,
    backgroundColor: colors.surface,
  },
  row: { minWidth: 0, flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
  inputShell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: radii.composer,
    backgroundColor: colors.surfaceContainer,
    overflow: "hidden",
  },
  menu: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: touchTarget,
    maxHeight: maximumInputHeight,
    ...typeScale.composerInput,
    fontFamily: productFonts.regular,
    color: colors.text,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.inputInset,
  },
  previewButton: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    borderRadius: radii.composer,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  previewPending: { ...typeScale.body, color: colors.onPrimary },
  error: { ...typeScale.body, color: colors.error },
});
