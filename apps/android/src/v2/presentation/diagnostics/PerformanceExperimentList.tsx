import { StyleSheet, Switch, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { PerformanceExperimentId } from "../../features/diagnostics/diagnosticsTypes";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { DiagnosticButton } from "./DiagnosticButton";

interface ExperimentDefinition {
  description: string;
  id: PerformanceExperimentId;
  title: string;
}

interface PerformanceExperimentListProps {
  enabled: Readonly<Record<PerformanceExperimentId, boolean>>;
  onChange(id: PerformanceExperimentId, enabled: boolean): void;
  onRun(id: PerformanceExperimentId): void;
  runningExperiment: PerformanceExperimentId | null;
}

interface ExperimentRowProps extends PerformanceExperimentListProps {
  definition: ExperimentDefinition;
}

const EXPERIMENTS: readonly ExperimentDefinition[] = [
  {
    description: "Isolate the native text shader.",
    id: "disableTextShimmer",
    title: "Disable text shimmer",
  },
  {
    description: "Bypass Markdown AST and rich renderers.",
    id: "plainTextMarkdown",
    title: "Plain-text Markdown",
  },
  {
    description: "Bypass the extra width-classification parse.",
    id: "skipMarkdownLayout",
    title: "Skip Markdown layout",
  },
  {
    description: "Replace virtualized thread lists with a placeholder.",
    id: "hideThreadLists",
    title: "Pause thread lists",
  },
  {
    description: "Stop shimmer, spinners, and custom motion.",
    id: "reduceCustomMotion",
    title: "Disable custom animations",
  },
];

export function PerformanceExperimentList(
  props: PerformanceExperimentListProps,
): React.JSX.Element {
  return (
    <>
      {EXPERIMENTS.map((definition) => (
        <ExperimentRow
          definition={definition}
          enabled={props.enabled}
          key={definition.id}
          onChange={props.onChange}
          onRun={props.onRun}
          runningExperiment={props.runningExperiment}
        />
      ))}
    </>
  );
}

function ExperimentRow(props: ExperimentRowProps): React.JSX.Element {
  const run = useEvent(() => props.onRun(props.definition.id));
  const change = useEvent((enabled: boolean) => props.onChange(props.definition.id, enabled));
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <ProductText>{props.definition.title}</ProductText>
        <ProductText style={styles.description} tone="muted">
          {props.definition.description}
        </ProductText>
      </View>
      <DiagnosticButton
        label="A/B"
        onPress={run}
        pending={props.runningExperiment === props.definition.id}
      />
      <Switch
        accessibilityLabel={props.definition.title}
        disabled={props.runningExperiment !== null}
        onValueChange={change}
        value={props.enabled[props.definition.id]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  description: { ...typeScale.caption },
  row: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingTop: spacing.xs,
  },
});
