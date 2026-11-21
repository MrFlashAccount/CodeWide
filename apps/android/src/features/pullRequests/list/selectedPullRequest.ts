import { createContext } from "react";

import type { PullRequestKey } from "../../../data/forgeContract";

/**
 * The pull request the destination beside the catalog shows, which its row marks as selected;
 * `null` when no pull request is shown beside the catalog.
 */
export const SelectedPullRequestContext = createContext<PullRequestKey | null>(null);
