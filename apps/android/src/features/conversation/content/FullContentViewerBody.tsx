import { Ionicons } from "@expo/vector-icons";
import type { Dispatch, SetStateAction } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from "react-native";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import { NativeCodeBlock } from "../../../rendering/NativeCodeBlock";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { CopyButton } from "../turns/MessageActionRail";
import { styles } from "./FullContentViewer.styles";
import type { FullContentViewerProps } from "./FullContentViewer.types";

/** Displays the current bounded output range; the host retains selection and measurement state. */
export function renderFullContentViewerBody({
  selection,
  onClose,
  onPrevious,
  onNext,
  viewportHeight,
  setViewportHeight,
  title,
  hasPrevious,
  hasNext,
  rangeEnd,
  formatContentBytes,
}: FullContentViewerProps & {
  viewportHeight: number;
  setViewportHeight: Dispatch<SetStateAction<number>>;
  title: string;
  hasPrevious: boolean;
  hasNext: boolean;
  rangeEnd: number;
  formatContentBytes(value: number): string;
}) {
  return (
    <View testID="full-content-viewer" style={styles.fullContentViewer}>
      <View style={styles.fullContentHeader}>
        <View style={styles.fullContentHeaderIcon}>
          <Ionicons name="terminal-outline" size={iconSize.navigation} color={colors.textMuted} />
        </View>
        <View style={styles.fullContentHeaderText}>
          <Text numberOfLines={1} style={styles.fullContentTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.fullContentMeta}>
            {selection.loading
              ? "Loading…"
              : `${selection.offset + 1}–${rangeEnd} / ${selection.reference.byteLength.toLocaleString()} bytes`}
          </Text>
        </View>
        {selection.text !== null && <CopyButton text={selection.text} />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close full output"
          onPress={onClose}
          style={styles.headerIcon}
        >
          <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      </View>
      <View
        style={styles.fullContentViewport}
        onLayout={(event) => {
          const nextHeight = Math.floor(event.nativeEvent.layout.height);
          setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
        }}
      >
        {selection.loading ? (
          <View style={styles.fullContentCentered}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.menuNotice}>Loading full output…</Text>
          </View>
        ) : selection.error !== null ? (
          <View style={styles.fullContentCentered}>
            <Text style={styles.errorText}>{selection.error}</Text>
          </View>
        ) : selection.text !== null && viewportHeight > 0 ? (
          selection.presentation === "markdown" ? (
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator
              contentContainerStyle={styles.fullContentMarkdown}
            >
              <RichMarkdown source={selection.text} />
            </ScrollView>
          ) : Platform.OS === "android" ? (
            <NativeCodeBlock
              value={selection.text}
              language="text"
              variant={selection.presentation === "terminal" ? "terminal" : "code"}
              maxHeight={viewportHeight}
              embeddedInParentScroll={false}
              truncate={false}
            />
          ) : (
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                contentContainerStyle={styles.fullContentRawHorizontal}
              >
                <Text selectable style={styles.fullContentRawText}>
                  {selection.presentation === "terminal"
                    ? stripTerminalControlSequences(selection.text)
                    : selection.text}
                </Text>
              </ScrollView>
            </ScrollView>
          )
        ) : null}
      </View>
      <View style={styles.fullContentFooter}>
        <Text style={styles.fullContentFooterText}>
          {formatContentBytes(selection.reference.byteLength)}
        </Text>
        <View style={styles.largeContentPager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous output page"
            disabled={!hasPrevious || selection.loading}
            onPress={onPrevious}
            style={[
              styles.largeContentPageButton,
              (!hasPrevious || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons name="chevron-back" size={iconSize.action} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next output page"
            disabled={!hasNext || selection.loading}
            onPress={onNext}
            style={[
              styles.largeContentPageButton,
              (!hasNext || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons name="chevron-forward" size={iconSize.action} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
