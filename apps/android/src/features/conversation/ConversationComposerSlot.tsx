import type { ReactElement } from "react";
import { ComposerLoadingPlaceholder } from "../composer/ComposerFeature";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";

/** Keeps the canonical composer dock occupied while its durable state is restored. */
export function ConversationComposerSlot({
  children,
  state,
}: {
  children: ReactElement;
  state: MainThreadReadCapabilities["composerState"];
}): ReactElement {
  return state.status === "loading" ? <ComposerLoadingPlaceholder /> : children;
}
