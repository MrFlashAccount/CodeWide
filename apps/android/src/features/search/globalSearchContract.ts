import type { SearchSession } from "./search-session";
import type { MessageSearchCapability } from "./searchCapabilities";
import type { SearchProject, SearchServer, SearchThread } from "./SearchFilters";
import type { SearchResultTarget } from "./searchResultTypes";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";

/** Search capability, scope data, and navigation actions for global search. */
export interface SearchScreenProps {
  readonly onClose: () => void;
  readonly onOpenThread: (target: SearchResultTarget, query: string) => void;
  readonly projects: readonly SearchProject[];
  readonly remote: MessageSearchCapability;
  readonly servers: readonly SearchServer[];
  readonly session: SearchSession;
  readonly threads: readonly SearchThread[];
  readonly voiceRuntime: AppVoiceInputRuntime | null;
}
