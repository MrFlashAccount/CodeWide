import { V2GeneratedContractError, validateV2ContractDefinition } from "./contract.generated";
import type { V2ClientFrame } from "./frames";
import { V2ProtocolValidationError } from "./validate-shared";

/** Validate from the generated schema immediately before serialization. */
export function validateV2ClientFrame(value: V2ClientFrame): V2ClientFrame {
  try {
    validateV2ContractDefinition("clientFrame", value);
  } catch (cause: unknown) {
    if (cause instanceof V2GeneratedContractError) throw new V2ProtocolValidationError("Invalid closed Sync V2 client frame");
    throw cause;
  }
  return value;
}
