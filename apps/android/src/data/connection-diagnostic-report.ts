export interface ConnectionDiagnosticReportInput {
  appVersion: string | null;
  connectionId: string;
  enabled: boolean;
  error: string;
  occurredAt: number | null;
  platform: string;
  platformVersion: string | number;
  state: string;
}

/** Builds a credential-free V1 connection report suitable for local copying. */
export function connectionDiagnosticReport(input: ConnectionDiagnosticReportInput): string {
  return [
    "CodeWide V1 connection failure",
    `Connection ID: ${input.connectionId}`,
    `State: ${input.state}`,
    `Enabled: ${String(input.enabled)}`,
    `Occurred at: ${formatTimestamp(input.occurredAt)}`,
    `App version: ${input.appVersion ?? "unknown"}`,
    `Platform: ${input.platform} ${String(input.platformVersion)}`,
    "Diagnostic:",
    input.error,
  ].join("\n");
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "unknown";
  return new Date(timestamp).toISOString();
}
