/**
 * Companion degradation for a feature the bound or owning agent provider lacks.
 *
 * A call that requires an undeclared capability returns JSON-RPC error `-32072`
 * with `data.capability` instead of hanging or failing generically (see
 * `docs/agent-providers.md`). Callers map it to their own "unavailable" state.
 */
import { RpcResponseError } from "@codewide/sync-client";

const AGENT_CAPABILITY_UNSUPPORTED_RPC_CODE = -32_072;

/** Whether `error` is the Companion's declared "capability not supported" rejection. */
export function isAgentCapabilityUnsupported(error: unknown): boolean {
  return error instanceof RpcResponseError && error.code === AGENT_CAPABILITY_UNSUPPORTED_RPC_CODE;
}
