import type { DiagnosticLogInput } from "./diagnosticReport";

/** Non-Android hosts keep their existing console diagnostics; Android owns the durable bridge. */
export function persistDiagnosticLog(_record: DiagnosticLogInput): void {}
