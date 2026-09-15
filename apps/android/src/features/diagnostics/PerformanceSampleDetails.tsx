import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { resetOperationalMetrics } from "../../data/operational-metrics";
import { setPerformanceExperiment } from "../../data/performance-experiments";
import { colors } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { ExperimentResultCard, OperationalMetrics } from "./OperationalMetrics";
import { Legend, MetricTile, PerformanceSparkline } from "./PerformanceCharts";
import { styles } from "./PerformanceDiagnostics.styles";
import { usePerformanceDiagnosticsState } from "./performanceDiagnosticsState";
import { EXPERIMENTS } from "./performanceExperiment";
import {
  bytes,
  bytesOrUnavailable,
  decimal,
  duration,
  integer,
  percent,
  rate,
} from "./performanceFormat";

/** Presents one available native sample and existing diagnostic experiment controls. */
export function renderPerformanceSampleDetails(
  state: ReturnType<typeof usePerformanceDiagnosticsState>,
  current: NonNullable<ReturnType<typeof usePerformanceDiagnosticsState>["current"]>,
) {
  return (
    <>
      <View style={styles.grid}>
        <MetricTile
          label="Process CPU"
          value={percent(current.cpuPercent)}
          detail={`peak ${percent(state.metrics.peakCpuPercent)}`}
        />
        <MetricTile
          label="Memory PSS"
          value={bytes(current.pssBytes)}
          detail={`peak ${bytes(state.metrics.peakPssBytes)}`}
        />
        <MetricTile
          label="Rendered FPS"
          value={decimal(current.renderedFps)}
          detail={`${current.renderedFrames} frames / sample`}
        />
        <MetricTile
          label="Frame p95"
          value={`${decimal(current.p95FrameMs)} ms`}
          detail={`avg ${decimal(current.averageFrameMs)} ms`}
        />
        <MetricTile
          label="Jank"
          value={percent(current.jankPercent)}
          detail={`session ${percent(state.metrics.sessionJankPercent)}`}
        />
        <MetricTile
          label="Missed estimate"
          value={integer(current.droppedFrameEstimate)}
          detail={`session ${integer(state.metrics.totalDroppedFrameEstimate)}`}
        />
        <MetricTile
          label="Download"
          value={rate(current.rxBytesPerSecond)}
          detail={`session ${bytesOrUnavailable(current.rxSessionBytes)}`}
        />
        <MetricTile
          label="Upload"
          value={rate(current.txBytesPerSecond)}
          detail={`session ${bytesOrUnavailable(current.txSessionBytes)}`}
        />
      </View>

      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartTitle}>Last 60 seconds</Text>
            <Text style={styles.chartSubtitle}>
              {duration(current.uptimeMs)} session · {state.metrics.historySamples}/
              {state.metrics.historyCapacity} native samples
            </Text>
          </View>
          <View style={styles.legend}>
            <Legend color={colors.green} label="CPU" />
            <Legend color={colors.amber} label="frame p95" />
          </View>
        </View>
        <PerformanceSparkline points={state.metrics.recent} />
      </View>

      <View style={styles.memoryRow}>
        <Text style={styles.memoryLabel}>RSS {bytes(current.rssBytes)}</Text>
        <Text style={styles.memoryLabel}>
          Java {bytes(current.javaHeapBytes)} / {bytes(current.javaHeapLimitBytes)}
        </Text>
        <Text style={styles.memoryLabel}>Native heap {bytes(current.nativeHeapBytes)}</Text>
      </View>
      <View style={styles.memoryBreakdown}>
        <Text style={styles.chartSubtitle}>PSS breakdown</Text>
        <View style={styles.memoryRow}>
          <Text style={styles.memoryLabel}>Java {bytes(current.javaHeapPssBytes)}</Text>
          <Text style={styles.memoryLabel}>Native {bytes(current.nativeHeapPssBytes)}</Text>
          <Text style={styles.memoryLabel}>Graphics {bytes(current.graphicsPssBytes)}</Text>
          <Text style={styles.memoryLabel}>Code {bytes(current.codePssBytes)}</Text>
          <Text style={styles.memoryLabel}>Stack {bytes(current.stackPssBytes)}</Text>
          <Text style={styles.memoryLabel}>Other {bytes(current.privateOtherPssBytes)}</Text>
          <Text style={styles.memoryLabel}>System {bytes(current.systemPssBytes)}</Text>
        </View>
      </View>
      <View style={styles.experimentCard}>
        <View style={styles.experimentHeader}>
          <View style={styles.experimentHeaderCopy}>
            <Text style={styles.chartTitle}>Session experiments</Text>
            <Text style={styles.chartSubtitle}>
              Safe A/B switches. Nothing is persisted; transport, projection and ACK stay active.
            </Text>
          </View>
          <View style={styles.diagnosticActionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void state.copySnapshot()}
              disabled={state.copyPending}
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
            >
              <Text style={styles.smallButtonText}>
                {state.snapshotCopied ? "Copied" : "Copy snapshot"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                resetOperationalMetrics();
                state.setExperimentResult(null);
                state.setDiagnosticRevision((value) => value + 1);
              }}
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
            >
              <Text style={styles.smallButtonText}>Reset data</Text>
            </Pressable>
          </View>
        </View>
        {EXPERIMENTS.map((experiment) => (
          <View key={experiment.id} style={styles.experimentRow}>
            <View style={styles.experimentCopy}>
              <Text style={styles.experimentTitle}>{experiment.title}</Text>
              <Text style={styles.experimentDescription}>{experiment.description}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={state.runningExperiment !== null}
              onPress={() => void state.runExperiment(experiment.id)}
              style={({ pressed }) => [
                styles.abButton,
                state.runningExperiment !== null && styles.buttonDisabled,
                pressed && styles.smallButtonPressed,
              ]}
            >
              {state.runningExperiment === experiment.id ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={styles.abButtonText}>A/B 16s</Text>
              )}
            </Pressable>
            <Switch
              accessibilityLabel={experiment.title}
              disabled={state.runningExperiment !== null}
              value={state.experiments[experiment.id]}
              onValueChange={(enabled) => setPerformanceExperiment(experiment.id, enabled)}
            />
          </View>
        ))}
      </View>

      <OperationalMetrics metrics={state.operational} />
      {state.experimentResult !== null && <ExperimentResultCard result={state.experimentResult} />}
      <Text style={styles.footnote}>
        Collection continues while the app process lives; one-second samples stay in a bounded
        one-hour native ring buffer. CPU is aggregate across cores; network values cover the app
        UID. Stock Android does not expose trustworthy per-app GPU or energy usage, so those are
        intentionally omitted.
      </Text>
    </>
  );
}
