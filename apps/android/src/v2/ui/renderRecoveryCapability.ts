import type { RecoveryHandler } from "./RenderFailureFallback";
import { renderRecoveryPrompt, type RecoverableRenderFailure } from "./renderRecoveryPrompt";

export interface RenderRepairChatRequest {
  prompt: string;
  title: string;
}

export interface RenderRecoveryCapabilityInput {
  context?(failure: RecoverableRenderFailure): string | undefined;
  openRepairChat(request: RenderRepairChatRequest): Promise<void>;
}

/** Builds the provider callback while leaving thread creation and navigation in the app shell. */
export function createRenderRecoveryHandler(input: RenderRecoveryCapabilityInput): RecoveryHandler {
  return async (failure) => {
    const inheritedContext = failure.context;
    const suppliedContext = input.context?.(failure);
    const context = joinContext(inheritedContext, suppliedContext);
    await input.openRepairChat({
      prompt: renderRecoveryPrompt({
        ...failure,
        ...(context === undefined ? {} : { context }),
      }),
      title: `Fix ${failure.label}`.slice(0, 80),
    });
  };
}

function joinContext(first: string | undefined, second: string | undefined): string | undefined {
  const values = [first, second].filter(nonEmpty);
  return values.length === 0 ? undefined : values.join("\n");
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}
