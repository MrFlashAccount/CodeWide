import {
  parseRichMarkdown,
  plainRichMarkdownRootText,
  richMarkdownBlockIndexAtLine,
} from "@codewide/rendering-core";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, spacing, typeScale } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { MarkdownNode } from "./MarkdownNode";
import { RecoverableMarkdownBoundary } from "./RecoverableMarkdownBoundary";
import { useV2RenderingCapabilities } from "./renderingCapabilities";
import { ResolvedImageGroup } from "./ResolvedImageGroup";
import type { RichExtensionRenderer } from "./richExtensionRenderer";
import { collectMarkdownImages, markdownImageRevision, markdownNodeKey } from "./richMarkdownModel";

export { richMarkdownLayout } from "./richMarkdownLayout";

const EMPTY_EXTENSIONS: Record<string, RichExtensionRenderer> = {};

export interface RichMarkdownProps {
  extensions?: Record<string, RichExtensionRenderer>;
  maxLines?: number;
  onTargetLayout?(y: number): void;
  reviewPathPrefix?: string;
  reviewTargetId?: string;
  source: string;
  streaming?: boolean;
  targetLine?: number;
}

export function RichMarkdown(props: RichMarkdownProps): React.JSX.Element {
  const {
    extensions = EMPTY_EXTENSIONS,
    maxLines,
    onTargetLayout,
    reviewPathPrefix = "segment-0",
    reviewTargetId,
    source,
    targetLine,
  } = props;
  return (
    <RecoverableMarkdownBoundary recoveryKey={source}>
      <RichMarkdownDocument
        extensions={extensions}
        reviewPathPrefix={reviewPathPrefix}
        source={source}
        {...(maxLines === undefined ? {} : { maxLines })}
        {...(onTargetLayout === undefined ? {} : { onTargetLayout })}
        {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
        {...(targetLine === undefined ? {} : { targetLine })}
      />
    </RecoverableMarkdownBoundary>
  );
}

function RichMarkdownDocument(props: RichMarkdownProps): React.JSX.Element {
  const {
    extensions = EMPTY_EXTENSIONS,
    maxLines,
    onTargetLayout,
    reviewPathPrefix = "segment-0",
    reviewTargetId,
    source,
    targetLine,
  } = props;
  const capabilities = useV2RenderingCapabilities();
  const parsed = parseRichMarkdown(source);
  if (maxLines !== undefined) {
    return (
      <Text ellipsizeMode="tail" numberOfLines={maxLines} selectable style={styles.paragraph}>
        {plainRichMarkdownRootText(parsed.root)}
      </Text>
    );
  }
  const images = collectMarkdownImages(parsed.root);
  const imageRevision = markdownImageRevision(images);
  const imageResourceRevision = `${imageRevision}\u0000${capabilities.imageSourceRevision ?? "public"}`;
  const targetIndex =
    targetLine === undefined ? null : richMarkdownBlockIndexAtLine(source, targetLine);
  return (
    <ResolvedImageGroup key={imageResourceRevision} references={images}>
      <View style={styles.document}>
        {parsed.root.children.map((node, index) => {
          const nodePath = markdownNodeKey(node, `${reviewPathPrefix}-${index}`);
          const content = (
            <MarkdownNode
              extensions={extensions}
              images={images}
              node={node}
              path={nodePath}
              {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
            />
          );
          if (targetIndex !== index || onTargetLayout === undefined) {
            return <View key={nodePath}>{content}</View>;
          }
          return (
            <TargetMarkdownBlock key={nodePath} onTargetLayout={onTargetLayout}>
              {content}
            </TargetMarkdownBlock>
          );
        })}
        {parsed.truncated ? (
          <View style={styles.truncated}>
            <Text style={styles.secondary}>
              Large message preview · {parsed.originalLength.toLocaleString()} characters
            </Text>
          </View>
        ) : null}
      </View>
    </ResolvedImageGroup>
  );
}

interface TargetMarkdownBlockProps {
  children: React.ReactNode;
  onTargetLayout(y: number): void;
}

function TargetMarkdownBlock(props: TargetMarkdownBlockProps): React.JSX.Element {
  const { children, onTargetLayout } = props;
  const measure = useEvent((event: LayoutChangeEvent) => {
    onTargetLayout(event.nativeEvent.layout.y);
  });
  return (
    <View collapsable={false} onLayout={measure}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  document: { gap: spacing.xs, minWidth: 0 },
  paragraph: { color: colors.text, ...typeScale.body, minWidth: 0 },
  secondary: { color: colors.textMuted },
  truncated: { borderTopColor: colors.borderSoft, borderTopWidth: 1, paddingTop: spacing.xs },
});
