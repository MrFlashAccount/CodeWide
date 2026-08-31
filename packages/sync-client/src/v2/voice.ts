import {
  V2GeneratedContractError,
  validateV2ContractDefinition,
  type V2VoiceClientRecord,
  type V2VoiceServerRecord,
} from "./contract.generated";
import { V2ProtocolValidationError } from "./validate-shared";

/** Validates Voice control records immediately before transport serialization. */
export function validateV2VoiceClientRecord(value: V2VoiceClientRecord): V2VoiceClientRecord {
  validateVoiceDefinition("voiceClientRecord", value, "Invalid closed V2 Voice client record");
  return value;
}

/** Parses Voice control records before a controller observes them. */
export function parseV2VoiceServerRecord(raw: string): V2VoiceServerRecord {
  const value = parseJson(raw, "Malformed V2 Voice JSON");
  validateVoiceDefinition("voiceServerRecord", value, "Invalid closed V2 Voice server record");
  return value as V2VoiceServerRecord;
}

function validateVoiceDefinition(
  name: "voiceClientRecord" | "voiceServerRecord",
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
