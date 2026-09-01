import type { ReactNode } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

interface TerminalWorkspaceViewProps {
  input: string;
  live: boolean;
  onInputChange(value: string): void;
  onSubmit(): void;
  openControl: ReactNode;
  output: string;
  state: string;
}

export function TerminalWorkspaceView(props: TerminalWorkspaceViewProps): React.JSX.Element {
  const { input, live, onInputChange, onSubmit, openControl, output, state } = props;
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={[styles.dot, live ? styles.dotLive : styles.dotIdle]} />
        <ProductText style={styles.tab} weight="semibold">
          Terminal
        </ProductText>
        <ProductText style={styles.state} tone="muted">
          {state}
        </ProductText>
        {openControl}
      </View>
      <ScrollView accessibilityLabel="Terminal output" style={styles.output}>
        <ProductText selectable style={styles.terminalText}>
          {output === "" ? "Terminal output will appear here." : output}
        </ProductText>
      </ScrollView>
      <View style={styles.inputRow}>
        <ProductText style={styles.prompt} tone="success">
          ›
        </ProductText>
        <TextInput
          accessibilityLabel="Terminal input"
          autoCapitalize="none"
          autoCorrect={false}
          editable={live}
          onChangeText={onInputChange}
          onSubmitEditing={onSubmit}
          placeholder="Enter a command"
          placeholderTextColor={colors.textDim}
          returnKeyType="send"
          style={styles.input}
          value={input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 4, height: 8, width: 8 },
  dotIdle: { backgroundColor: colors.textDim },
  dotLive: { backgroundColor: colors.green },
  input: {
    color: colors.text,
    flex: 1,
    ...typeScale.code,
    minHeight: 46,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  inputRow: {
    alignItems: "center",
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    margin: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  output: { backgroundColor: colors.code, flex: 1, padding: spacing.sm },
  prompt: { ...typeScale.code },
  root: { backgroundColor: colors.code, flex: 1, minHeight: 0 },
  state: { ...typeScale.caption, marginLeft: "auto", textTransform: "capitalize" },
  tab: { ...typeScale.body },
  terminalText: { color: "#D7FBD7", ...typeScale.code },
  toolbar: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
});
