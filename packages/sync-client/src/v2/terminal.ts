import {
  V2GeneratedContractError,
  validateV2ContractDefinition,
  type V2TerminalClientRecord,
  type V2TerminalServerRecord,
} from "./contract.generated";
import { V2ProtocolValidationError } from "./validate-shared";

/** Validates Terminal control records immediately before transport serialization. */
export function validateV2TerminalClientRecord(value: V2TerminalClientRecord): V2TerminalClientRecord {
  validateTerminalDefinition("terminalClientRecord", value, "Invalid closed V2 Terminal client record");
  return value;
}

/** Parses Terminal control records before a controller observes them. */
export function parseV2TerminalServerRecord(raw: string): V2TerminalServerRecord {
  const value = parseJson(raw, "Malformed V2 Terminal JSON");
  validateTerminalDefinition("terminalServerRecord", value, "Invalid closed V2 Terminal server record");
  return value as V2TerminalServerRecord;
}

function validateTerminalDefinition(
  name: "terminalClientRecord" | "terminalServerRecord",
  value: unknown,
  message: string,
): void {
  try {
    validateV2ContractDefinition(name, value);
  } catch (cause: unknown) {
    if (cause instanceof V2GeneratedContractError) throw new V2ProtocolValidationError(message);
    throw cause;
  }
}

function parseJson(raw: string, message: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new V2ProtocolValidationError(message);
  }
}
