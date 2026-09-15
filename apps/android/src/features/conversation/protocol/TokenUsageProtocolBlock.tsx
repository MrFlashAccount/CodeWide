/** V1 TokenUsageProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { compactNumber } from "../../../ui/number-format";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { AppText as Text } from "../../../ui/Typography";
import { CopyButton } from "../turns/MessageActionRail";
import { protocolCopyText } from "./protocolCopyText";
import { numberValue, recordValue } from "./protocolValue";
import { styles } from "./TokenUsageProtocolBlock.styles";

export function TokenUsageProtocolBlock({ block }: { block: RenderBlock }) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const total = recordValue(block.raw.total);
  const last = recordValue(block.raw.last);
  const metrics: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: number | null;
  }> = [
    { icon: "speedometer-outline", label: "Total", value: numberValue(total.totalTokens) },
    { icon: "log-in-outline", label: "Input", value: numberValue(total.inputTokens) },
    { icon: "log-out-outline", label: "Output", value: numberValue(total.outputTokens) },
    { icon: "flash-outline", label: "Last turn", value: numberValue(last.totalTokens) },
    {
      icon: "scan-outline",
      label: "Context window",
      value: numberValue(block.raw.modelContextWindow),
    },
  ];
  return (
    <View style={[styles.tokenStrip, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <View style={styles.tokenStripTitle}>
        <InlineIcon name="speedometer-outline" role="label" color={colors.textMuted} />
        <Text style={styles.cardTitle}>Usage</Text>
      </View>
      <View style={styles.tokenMetrics}>
        {metrics.map((metric) =>
          metric.value === null ? null : (
            <View
              key={metric.label}
              accessible
              accessibilityLabel={`${metric.label}: ${metric.value.toLocaleString()} tokens`}
              style={styles.tokenMetric}
            >
              <InlineIcon name={metric.icon} role="label" color={colors.textMuted} />
              <Text style={styles.tokenMetricValue}>
                {TOKEN_SYMBOL}
                {compactNumber(metric.value)}
              </Text>
            </View>
          ),
        )}
      </View>
      <CopyButton getText={() => protocolCopyText(block)} />
    </View>
  );
}
