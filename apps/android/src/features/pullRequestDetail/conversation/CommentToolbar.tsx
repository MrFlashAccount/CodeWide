import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize, typeScale, typeWeight } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CommentFormat } from "./commentMarkdown";

type Glyph = { readonly icon: ComponentProps<typeof Ionicons>["name"] } | { readonly text: string };
type Tool = {
  readonly action: CommentFormat | "attach";
  readonly glyph: Glyph;
  readonly label: string;
};
const tools: readonly Tool[] = [
  { action: "bold", glyph: { text: "B" }, label: "Bold" },
  { action: "italic", glyph: { text: "I" }, label: "Italic" },
  { action: "link", glyph: { icon: "link-outline" }, label: "Insert link" },
  { action: "attach", glyph: { icon: "attach-outline" }, label: "Attach file" },
  { action: "image", glyph: { icon: "image-outline" }, label: "Insert image by URL" },
  { action: "bullet", glyph: { icon: "list-outline" }, label: "Bulleted list" },
  { action: "number", glyph: { text: "1." }, label: "Numbered list" },
  { action: "task", glyph: { icon: "checkbox-outline" }, label: "Task list" },
  { action: "heading", glyph: { text: "H" }, label: "Heading" },
  { action: "strike", glyph: { text: "S" }, label: "Strikethrough" },
  { action: "quote", glyph: { icon: "chatbox-ellipses-outline" }, label: "Quote" },
  { action: "code", glyph: { icon: "code-outline" }, label: "Inline code" },
  { action: "block", glyph: { icon: "code-working-outline" }, label: "Code block" },
];

/** Horizontally scrollable authoring controls above the system keyboard. */
export function CommentToolbar({
  onAttach,
  onFormat,
}: {
  readonly onAttach: (() => void) | null;
  readonly onFormat: (action: CommentFormat) => void;
}): React.JSX.Element {
  const activate = useEvent((action: Tool["action"]) => {
    if (action === "attach") {
      onAttach?.();
    } else {
      onFormat(action);
    }
  });
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
    >
      {tools.map((tool) =>
        tool.action === "attach" && onAttach === null ? null : (
          <ToolbarButton key={tool.action} onActivate={activate} tool={tool} />
        ),
      )}
    </ScrollView>
  );
}

function ToolbarButton({
  onActivate,
  tool,
}: {
  readonly onActivate: (action: Tool["action"]) => void;
  readonly tool: Tool;
}): React.JSX.Element {
  const press = useEvent(() => {
    onActivate(tool.action);
  });
  return (
    <Pressable
      accessibilityLabel={tool.label}
      accessibilityRole="button"
      onPress={press}
      style={styles.button}
    >
      {"icon" in tool.glyph ? (
        <Ionicons color={colors.text} name={tool.glyph.icon} size={iconSize.action} />
      ) : (
        <Text
          style={[
            styles.glyph,
            tool.action === "bold" && styles.bold,
            tool.action === "italic" && styles.italic,
            tool.action === "strike" && styles.strike,
          ]}
        >
          {tool.glyph.text}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  bold: { fontWeight: typeWeight.semibold },
  button: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  glyph: {
    ...typeScale.title,
    color: colors.text,
  },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
});
