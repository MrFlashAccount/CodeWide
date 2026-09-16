import { renderMessageMath } from "@codewide/rendering-core/math";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { colors, spacing, typeScale } from "../theme";

interface NativeMathProps {
  readonly display: boolean;
  readonly source: string;
}

/** Loaded only for formulas; ordinary chats do not initialize the typesetting engine. */
export default function NativeMath(props: NativeMathProps): ReactNode {
  const result = renderMessageMath(props.source, props.display, typeScale.body.fontSize);
  if (result.status === "invalid") {
    return (
      <Text accessibilityLabel="Unfinished or unsupported formula" selectable style={styles.code}>
        {props.source}
      </Text>
    );
  }
  const formula = (
    <View
      accessibilityLabel={props.source}
      accessibilityRole="text"
      accessible
      style={{ height: result.height, width: result.width }}
    >
      <SvgXml color={colors.text} height={result.height} width={result.width} xml={result.svg} />
    </View>
  );
  return props.display ? (
    <ScrollView contentContainerStyle={styles.formula} horizontal nestedScrollEnabled>
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
