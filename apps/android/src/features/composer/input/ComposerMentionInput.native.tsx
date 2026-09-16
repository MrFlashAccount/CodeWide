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
  { icon: "code-slash-outline", id: "codeBlock", label: "Code block" },
  { icon: "list-outline", id: "list", label: "Bulleted list" },
  { icon: "list-outline", id: "orderedList", label: "Numbered list" },
  { icon: "sparkles-outline", id: "skills", label: "Skills" },
  { icon: "at-outline", id: "context", label: "Context" },
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
  const dismissTools = () => {
    setToolsOpen(false);
  };
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
    if (reading) {
      return;
    }
    startReading(async () => {
      setReadError(false);
      try {
        const editor = input.current;
        if (editor === null) {
          return;
        }
        const markdown = await editor.getMarkdown();
        if (mounted.current) {
          props.onPreviewMarkdown(markdown);
        }
      } catch {
        if (mounted.current) {
          setReadError(true);
        }
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
              accessibilityLabel="Composer tools"
              accessibilityRole="button"
              accessibilityState={{ expanded: toolsOpen }}
              onPress={toggleTools}
              style={styles.menu}
            >
              <Ionicons color={colors.text} name="add" size={iconSize.navigation} />
            </Pressable>
          </CodeWideMenu>
          <ComposerMarkdownInput
            accessibilityLabel="Message Codex"
            mentionIndicators={indicators}
            onChangeText={setValue}
            placeholder="Message Codex…"
            ref={input}
            search={props.search}
            style={styles.input}
            value={value}
          />
        </View>
        <Pressable
          accessibilityHint="Shows Markdown locally. Does not send a message."
          accessibilityLabel="Preview Markdown"
          accessibilityRole="button"
          accessibilityState={{ busy: reading, disabled: reading }}
          disabled={reading}
          onPress={preview}
          style={styles.previewButton}
        >
          {reading ? (
            <AppText style={styles.previewPending}>…</AppText>
          ) : (
            <Ionicons color={colors.onPrimary} name="arrow-up" size={iconSize.navigation} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    flexShrink: 1,
    minHeight: 0,
    minWidth: 0,
    paddingBottom: spacing.compact,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xxs,
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  input: {
    maxHeight: maximumInputHeight,
    minHeight: touchTarget,
    ...typeScale.composerInput,
    color: colors.text,
    fontFamily: productFonts.regular,
    paddingBottom: spacing.inputInset,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.sm,
    paddingTop: spacing.sm,
  },
  inputShell: {
    alignItems: "flex-end",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.composer,
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    overflow: "hidden",
  },
  menu: {
    alignItems: "center",
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  previewButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.composer,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  previewPending: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  row: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
});
