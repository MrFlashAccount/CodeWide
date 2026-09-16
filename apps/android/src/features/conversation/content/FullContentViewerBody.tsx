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
  formatContentBytes,
  hasNext,
  hasPrevious,
  onClose,
  onNext,
  onPrevious,
  rangeEnd,
  selection,
  setViewportHeight,
  title,
  viewportHeight,
}: FullContentViewerProps & {
  formatContentBytes: (value: number) => string;
  hasNext: boolean;
  hasPrevious: boolean;
  rangeEnd: number;
  setViewportHeight: Dispatch<SetStateAction<number>>;
  title: string;
  viewportHeight: number;
}) {
  return (
    <View style={styles.fullContentViewer} testID="full-content-viewer">
      <View style={styles.fullContentHeader}>
        <View style={styles.fullContentHeaderIcon}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.navigation} />
        </View>
        <View style={styles.fullContentHeaderText}>
          <Text numberOfLines={1} style={styles.fullContentTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.fullContentMeta}>
            {selection.loading
              ? "Loading…"
              : `${String(selection.offset + 1)}–${String(rangeEnd)} / ${selection.reference.byteLength.toLocaleString()} bytes`}
          </Text>
        </View>
        {selection.text !== null && <CopyButton text={selection.text} />}
        <Pressable
          accessibilityLabel="Close full output"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.headerIcon}
        >
          <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
        </Pressable>
      </View>
      <View
        onLayout={(event) => {
          const nextHeight = Math.floor(event.nativeEvent.layout.height);
          setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
        }}
        style={styles.fullContentViewport}
      >
        {selection.loading ? (
          <View style={styles.fullContentCentered}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.menuNotice}>Loading full output…</Text>
          </View>
        ) : selection.error !== null ? (
          <View style={styles.fullContentCentered}>
            <Text style={styles.errorText}>{selection.error}</Text>
          </View>
        ) : selection.text !== null && viewportHeight > 0 ? (
          selection.presentation === "markdown" ? (
            <ScrollView
              contentContainerStyle={styles.fullContentMarkdown}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <RichMarkdown source={selection.text} />
            </ScrollView>
          ) : Platform.OS === "android" ? (
            <NativeCodeBlock
              embeddedInParentScroll={false}
              language="text"
              maxHeight={viewportHeight}
              truncate={false}
              value={selection.text}
              variant={selection.presentation === "terminal" ? "terminal" : "code"}
            />
          ) : (
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
              <ScrollView
                contentContainerStyle={styles.fullContentRawHorizontal}
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
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
            accessibilityLabel="Previous output page"
            accessibilityRole="button"
            disabled={!hasPrevious || selection.loading}
            onPress={onPrevious}
            style={[
              styles.largeContentPageButton,
              (!hasPrevious || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons color={colors.text} name="chevron-back" size={iconSize.action} />
          </Pressable>
          <Pressable
            accessibilityLabel="Next output page"
            accessibilityRole="button"
            disabled={!hasNext || selection.loading}
            onPress={onNext}
            style={[
              styles.largeContentPageButton,
              (!hasNext || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons color={colors.text} name="chevron-forward" size={iconSize.action} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
