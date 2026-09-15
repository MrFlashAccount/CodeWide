import type { SearchSession } from "./search-session";
import type { MessageSearchCapability } from "./searchCapabilities";
import { type SearchProject, type SearchServer, type SearchThread } from "./SearchFilters";
import type { SearchResultTarget } from "./searchResultTypes";

export interface SearchScreenProps {
  readonly remote: MessageSearchCapability;
  readonly servers: readonly SearchServer[];
  readonly threads: readonly SearchThread[];
  readonly projects: readonly SearchProject[];
  readonly session: SearchSession;
  readonly onClose: () => void;
  readonly onOpenThread: (target: SearchResultTarget, query: string) => void;
}
