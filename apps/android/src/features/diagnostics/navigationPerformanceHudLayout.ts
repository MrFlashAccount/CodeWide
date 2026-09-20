import { usePerformanceMonitoringEnabled } from "../../native/performance-metrics";
import { layoutSize } from "../../theme";

/** Reserves the vertical space occupied by the enabled navigation diagnostics HUD. */
export function useNavigationPerformanceHudInset(): number {
  return usePerformanceMonitoringEnabled() ? layoutSize.metadataRow : 0;
}
