import type {
  PullRequestCategory,
  PullRequestListPage,
} from "../../../data/forgePullRequestContract";
import { isCatalogAccount } from "./catalogAccounts";

/** One chip of the category row. */
export type PullRequestCategoryOption = {
  readonly category: PullRequestCategory;
  readonly label: string;
};

/** Catalog order and concise chip copy of every category. */
const CATEGORY_OPTIONS: readonly PullRequestCategoryOption[] = [
  { category: "involved", label: "Involved" },
  { category: "reviewRequested", label: "To review" },
  { category: "authored", label: "Mine" },
  { category: "assigned", label: "Assigned" },
  { category: "mentioned", label: "Mentioned" },
  { category: "drafts", label: "Drafts" },
  { category: "all", label: "All" },
];

/**
 * Categories that at least one catalog account of the published page
 * supports, in catalog order. The applied category always stays selectable;
 * a single choice is no choice, so the row is then empty.
 */
export function pullRequestCategoryOptions(
  page: PullRequestListPage | null,
  applied: PullRequestCategory,
): readonly PullRequestCategoryOption[] {
  if (page === null) {
    return [];
  }
  const supported = new Set<PullRequestCategory>([applied]);
  for (const section of page.sections) {
    if (isCatalogAccount(section.account)) {
      for (const category of section.supportedCategories) {
        supported.add(category);
      }
    }
  }
  return supported.size === 1
    ? []
    : CATEGORY_OPTIONS.filter((option) => supported.has(option.category));
}
