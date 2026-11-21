import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { KeyboardDock } from "../../../ui/KeyboardDock";
import { LineCommentComposer, type LineCommentComposerProps } from "./LineCommentComposer";

/** Props of the review content with its docked line composer. */
export type LineCommentFrameProps = {
  /** The toolbar and diff stay interactive while the composer is collapsed. */
  readonly children: ReactNode;
  /** The open composer, or `null` while no line is anchored. */
  readonly composer: LineCommentComposerProps | null;
};

/**
 * Review content with the line composer docked at its bottom above the
 * keyboard. There is no scrim and no modal window: the content keeps its
 * scrolling, selection and line taps, and keeps the collapsed composer's height
 * clear so its last lines stay reachable. The composer keeps one instance while
 * it is re-anchored or expanded. Expansion covers the toolbar and removes the
 * workspace behind the composer from touch and accessibility navigation.
 */
export function LineCommentFrame(props: LineCommentFrameProps): React.JSX.Element {
  const [clearance, setClearance] = useState(0);
  const [expanded, setExpanded] = useState(false);
  if (props.composer === null && expanded) {
    setExpanded(false);
  }
  const toggleExpanded = useEvent((): void => {
    setExpanded((current) => !current);
  });
  const reserve = useEvent((height: number): void => {
    setClearance(height);
  });
  const { composer } = props;
  return (
    <View style={styles.frame}>
      <View
        accessibilityElementsHidden={expanded}
        importantForAccessibility={expanded ? "no-hide-descendants" : "auto"}
        pointerEvents={expanded ? "none" : "auto"}
        style={[
          styles.content,
          { paddingBottom: composer === null ? 0 : clearance },
          expanded && styles.hidden,
        ]}
      >
        {props.children}
      </View>
      {composer === null ? null : (
        <KeyboardDock>
          <LineCommentComposer
            {...composer}
            expanded={expanded}
            onCollapsedHeight={reserve}
            onToggleExpanded={toggleExpanded}
          />
        </KeyboardDock>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    minHeight: 0,
  },
  frame: {
    flex: 1,
    minHeight: 0,
  },
  hidden: { opacity: 0 },
});
