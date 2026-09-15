import { renderMessageMath } from "@codewide/rendering-core/math";
import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { colors, spacing, typeScale } from "../theme";

interface NativeMathProps {
  readonly source: string;
  readonly display: boolean;
}

/** Loaded only for formulas; ordinary chats do not initialize the typesetting engine. */
export default function NativeMath(props: NativeMathProps): ReactNode {
  const result = useMemo(
    () => renderMessageMath(props.source, props.display, typeScale.body.fontSize),
    [props.source, props.display],
  );
  if (result.status === "invalid")
    return (
      <Text selectable accessibilityLabel="Unfinished or unsupported formula" style={styles.code}>
        {props.source}
      </Text>
    );
  const formula = (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={props.source}
      style={{ width: result.width, height: result.height }}
    >
      <SvgXml xml={result.svg} width={result.width} height={result.height} color={colors.text} />
    </View>
  );
  return props.display ? (
    <ScrollView horizontal nestedScrollEnabled contentContainerStyle={styles.formula}>
      {formula}
    </ScrollView>
  ) : (
    formula
  );
}

const styles = StyleSheet.create({
  code: {
    color: colors.text,
    ...typeScale.code,
  },
  formula: { paddingVertical: spacing.xs },
});
