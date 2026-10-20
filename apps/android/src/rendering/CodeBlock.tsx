import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii } from "../theme";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { CodeBlockHeader } from "./CodeBlockHeader";
import { FullscreenCodeBlock } from "./FullscreenCodeBlock";
import { NativeCodeBlock } from "./NativeCodeBlock";
import type { NativeCodeVariant } from "./native-code-block";
import { richMarkdownGeometry } from "./richMarkdownGeometry";
import { useCopyFeedback } from "./useCopyFeedback";

/** Shared interactive code surface for Markdown and document previews. */
export function CodeBlock({
  fillAvailableWidth = false,
  language,
  maxHeight,
  maxVisibleLines,
  scale = 1,
  truncate = true,
  value,
  variant = "code",
}: {
  readonly fillAvailableWidth?: boolean;
  readonly language: string;
  readonly maxHeight?: number;
  readonly maxVisibleLines?: number;
  readonly scale?: number;
  readonly truncate?: boolean;
  readonly value: string;
  readonly variant?: NativeCodeVariant;
}): ReactElement {
  const fullscreen = useAppFullscreenOverlay();
  const [copied, copy] = useCopyFeedback(value);
  const openFullscreen = useEvent(() => {
    fullscreen.present(({ close }) => (
      <FullscreenCodeBlock language={language} onClose={close} value={value} variant={variant} />
    ));
  });
  return (
    <View style={styles.container}>
      <CodeBlockHeader
        copied={copied}
        language={language}
        onCopy={copy}
        onOpenFullscreen={openFullscreen}
        scale={scale}
      />
      <NativeCodeBlock
        fillAvailableWidth={fillAvailableWidth}
        language={language}
        value={value}
        variant={variant}
        {...(maxHeight === undefined ? {} : { maxHeight })}
        {...(maxVisibleLines === undefined ? {} : { maxVisibleLines })}
        {...(!truncate ? { truncate: false } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: richMarkdownGeometry.codeBorderWidth,
    gap: richMarkdownGeometry.codeGap,
    maxWidth: "100%",
    minWidth: 0,
    padding: richMarkdownGeometry.codePadding,
    width: "100%",
  },
});
