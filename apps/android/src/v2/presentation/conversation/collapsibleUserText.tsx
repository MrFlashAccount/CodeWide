import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { colors, spacing, typeScale, typeWeight } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text } from "../text/ProductText";

const COLLAPSED_LINES = 25;
const COLLAPSED_CHARACTERS = 1800;

interface CollapsibleUserTextProps {
  text: string;
}

/** Keeps large authoritative user messages bounded until explicitly expanded. */
export function CollapsibleUserText(props: CollapsibleUserTextProps): React.JSX.Element {
  const { text } = props;
  const [expanded, setExpanded] = useState(false);
  const collapsible =
    text.length > COLLAPSED_CHARACTERS || text.split("\n").length > COLLAPSED_LINES;
  const toggleExpanded = useEvent(() => setExpanded((current) => !current));
  return (
    <View style={styles.block}>
      <RichMarkdown
        {...(!expanded && collapsible ? { maxLines: COLLAPSED_LINES } : {})}
        source={text}
      />
      {collapsible ? (
        <Pressable
          accessibilityLabel={expanded ? "Collapse message" : "Show full message"}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={toggleExpanded}
          style={styles.button}
        >
          <Text style={styles.label}>{expanded ? "Collapse" : "Show full message"}</Text>
          <PresentationIcon
            color={colors.textMuted}
            name={expanded ? "chevronUp" : "chevronDown"}
            size={typeScale.label.fontSize}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { minWidth: 0 },
  button: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "flex-end",
    minHeight: spacing.xl,
    paddingTop: spacing.xxs,
  },
  label: { color: colors.textMuted, ...typeScale.caption, fontWeight: typeWeight.semibold },
});
