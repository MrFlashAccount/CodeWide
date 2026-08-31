import type { V2OperationStatus } from "@codewide/sync-client/v2";

export const operationDisplayModel = (operation: V2OperationStatus): string =>
  `${operation.commandKind}: ${operation.state}`;
