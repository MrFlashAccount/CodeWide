/** The pure wording of a push event's commit rows. */
import type { EventCommit, EventCommits } from "../../../data/forgeConversationContract";

const SHORT_SHA_LENGTH = 7;

/** The commit's abbreviated id: the forge's own, else the first seven characters. */
export function shortSha(commit: EventCommit): string {
  return commit.shortSha ?? commit.sha.slice(0, SHORT_SHA_LENGTH);
}

/** What the rows leave out when the push had more commits than it lists. */
export function moreCommitsLabel(commits: EventCommits): string | null {
  const more = commits.total - commits.items.length;
  if (more <= 0) {
    return null;
  }
  return more === 1 ? "and 1 more commit" : `and ${String(more)} more commits`;
}
