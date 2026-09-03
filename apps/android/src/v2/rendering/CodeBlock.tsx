import Ionicons from "@expo/vector-icons/Ionicons";
import { setStringAsync } from "expo-clipboard";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { NativeCodeBlock } from "./NativeCodeBlock";
import { fullCodePageEntries } from "./nativeCodeBlockModel";

interface CodeBlockProps {
  language: string;
  showFullscreen?: boolean;
  value: string;
}

export function CodeBlock(props: CodeBlockProps): React.JSX.Element {
  const { language, showFullscreen = true, value } = props;
  const [copyState, setCopyState] = useState<"copied" | "error" | "idle" | "pending">("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const copying = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useEvent((): void => {
    if (copying.current) return;
    copying.current = true;
    setCopyState("pending");
    setStringAsync(value).then(
      () => {
        copying.current = false;
        setCopyState("copied");
        if (resetTimer.current !== null) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null;
          setCopyState("idle");
        }, 900);
      },
      () => {
        copying.current = false;
        setCopyState("error");
      },
    );
  });
  const openFullOutput = useEvent(() => {
    setFullscreen(true);
  });
  const closeFullOutput = useEvent(() => setFullscreen(false));
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.language}>{language}</Text>
        <Pressable
          accessibilityLabel={`Copy ${language} code block`}
          accessibilityRole="button"
          accessibilityState={{ busy: copyState === "pending", disabled: copyState === "pending" }}
          disabled={copyState === "pending"}
          onPress={copy}
          style={styles.action}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.hint, copyState === "copied" ? styles.copied : null]}
          >
            {copyLabel(copyState)}
          </Text>
        </Pressable>
        {showFullscreen ? (
          <Pressable
            accessibilityLabel={`Open full ${language} output`}
            accessibilityRole="button"
            onPress={openFullOutput}
            style={styles.action}
          >
            <Ionicons color={colors.textDim} name="expand-outline" size={16} />
          </Pressable>
        ) : null}
      </View>
      <NativeCodeBlock language={language} value={value} />
      {fullscreen ? (
        <FullCodeModal
          language={language}
          onClose={closeFullOutput}
          value={value}
          visible={fullscreen}
        />
      ) : null}
    </View>
  );
}

function copyLabel(state: "copied" | "error" | "idle" | "pending"): string {
  if (state === "copied") return "Copied";
  if (state === "error") return "Copy failed · Retry";
  if (state === "pending") return "Copying…";
  return "Copy";
}

interface FullCodeModalProps extends CodeBlockProps {
  onClose(): void;
  visible: boolean;
}

function FullCodeModal(props: FullCodeModalProps): React.JSX.Element {
  const { language, onClose, value, visible } = props;
  const insets = useSafeAreaInsets();
  const pages = fullCodePageEntries(value);
  return (
    <Modal animationType="none" onRequestClose={onClose} visible={visible}>
      <View style={[styles.fullscreen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
        <View style={styles.fullscreenHeader}>
          <Text numberOfLines={1} style={styles.fullscreenTitle}>
            {language} output
          </Text>
          <Pressable
            accessibilityLabel="Close full output"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.close}
          >
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.fullscreenContent}>
          {pages.map((page) => (
            <NativeCodeBlock
              key={page.id}
              language={language}
              maxHeight={10_008}
              truncate={false}
              value={page.value}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", justifyContent: "center", minHeight: touchTarget },
  close: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  container: {
    alignSelf: "stretch",
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    padding: spacing.xs,
    width: "100%",
  },
  copied: { color: colors.green },
  fullscreen: { backgroundColor: colors.background, flex: 1 },
  fullscreenContent: { padding: spacing.sm },
  fullscreenHeader: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
  },
  fullscreenTitle: { color: colors.text, flex: 1 },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 28 },
  hint: { color: colors.textDim },
  language: { color: colors.textDim, flex: 1, textTransform: "uppercase" },
});
