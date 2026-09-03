import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { NavigationPerformanceHud } from "../../presentation/diagnostics/NavigationPerformanceHud";
import { diagnosticBytes, diagnosticDecimal } from "./diagnosticFormat";
import type {
  NavigationDiagnosticsSource,
  PerformanceMetricsSnapshot,
  SpeedscopeProfileDocument,
} from "./diagnosticsTypes";
import { serializeNavigationSpeedscopeProfile } from "./navigationProfile";

interface NavigationDiagnosticsFeatureProps {
  metrics: PerformanceMetricsSnapshot;
  onOpenProfile(document: SpeedscopeProfileDocument): void;
  source: NavigationDiagnosticsSource;
}

export function NavigationDiagnosticsFeature(
  props: NavigationDiagnosticsFeatureProps,
): React.JSX.Element | null {
  const profiles = useSyncExternalStore(
    props.source.subscribe,
    props.source.snapshot,
    props.source.snapshot,
  );
  const [heapBusy, setHeapBusy] = useState(false);
  const [heapMessage, setHeapMessage] = useState("Full retained object graph");
  const profile = profiles.active ?? profiles.last;
  const openTimeline = useEvent(() => {
    if (profile === null) return;
    props.onOpenProfile({
      content: serializeNavigationSpeedscopeProfile(profile),
      fileName: `${profile.id}.speedscope.json`,
      title: "Navigation timeline",
    });
  });
  const openHermes = useEvent(() => {
    const content = profile?.frames?.hermesProfile?.content;
    if (profile === null || content === null || content === undefined) return;
    props.onOpenProfile({
      content,
      fileName: `${profile.id}.cpuprofile`,
      title: "Hermes CPU profile",
    });
  });
  const copy = useEvent(() => {
    if (profile !== null) {
      props.source.copyReport(profile).catch(() => undefined);
    }
  });
  const captureHeap = useEvent(() => {
    if (heapBusy) return;
    setHeapBusy(true);
    setHeapMessage("Running full GC and writing retained object graph…");
    void props.source
      .captureHeap()
      .then((heap) => setHeapMessage(`Saved ${diagnosticBytes(heap.sizeBytes)} · ${heap.location}`))
      .catch((cause: unknown) =>
        setHeapMessage(
          cause instanceof Error ? cause.message : "Could not capture the Hermes heap",
        ),
      )
      .finally(() => setHeapBusy(false));
  });
  const current = props.metrics.current;
  const frameSummary =
    current === null
      ? "collecting frames"
      : `${diagnosticDecimal(current.renderedFps)} fps · p95 ${diagnosticDecimal(current.p95FrameMs)} ms · ${diagnosticDecimal(current.jankPercent)}% jank · ${diagnosticBytes(current.pssBytes)}`;
  if (!props.metrics.enabled) return null;
  return (
    <NavigationPerformanceHud
      frameSummary={frameSummary}
      heapBusy={heapBusy}
      heapMessage={heapMessage}
      onCaptureHeap={captureHeap}
      onCopy={copy}
      onOpenHermes={openHermes}
      onOpenTimeline={openTimeline}
      profile={profile}
    />
  );
}
