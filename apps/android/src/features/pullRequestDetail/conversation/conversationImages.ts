/**
 * Direct image access for the PR conversation. Images whose source the plugin paired with a
 * credential-free URL (`comment.media`), and avatars it marked public (`avatarDirect`), load
 * on the phone without the companion; every other image keeps the companion media path.
 * Decisions follow the plugin's marks only, never the forge's name.
 */
import type {
  ConversationComment,
  ConversationEntry,
  ConversationPage,
} from "../../../data/forgeConversationContract";
import type { DirectImageGrant, DirectImageSources } from "../../../rendering/directImageSources";

type Author = ConversationComment["author"];

/** Every grant of a page, keyed by the image reference exactly as the body or author wrote it. */
function conversationImageGrants(
  page: ConversationPage | null,
): ReadonlyMap<string, DirectImageGrant> {
  const grants = new Map<string, DirectImageGrant>();
  if (page === null) {
    return grants;
  }
  const addAuthor = (author: Author | null): void => {
    if (
      author?.avatarDirect === true &&
      author.avatarUrl !== null &&
      !grants.has(author.avatarUrl)
    ) {
      grants.set(author.avatarUrl, {
        expiresAtMs: null,
        identity: author.avatarUrl,
        url: author.avatarUrl,
      });
    }
  };
  const addComment = (comment: ConversationComment): void => {
    addAuthor(comment.author);
    for (const media of comment.media) {
      if (!grants.has(media.source)) {
        // The source, not the signed URL, names the bytes: a refreshed URL hits the same cache entry.
        grants.set(media.source, {
          expiresAtMs: media.expiresAtMs,
          identity: media.source,
          url: media.url,
        });
      }
    }
  };
  for (const entry of page.entries) {
    addEntry(entry, addComment, addAuthor);
  }
  return grants;
}

function addEntry(
  entry: ConversationEntry,
  addComment: (comment: ConversationComment) => void,
  addAuthor: (author: Author | null) => void,
): void {
  if (entry.kind === "comment") {
    addComment(entry.comment);
  } else if (entry.kind === "review") {
    addAuthor(entry.author);
    if (entry.body !== null) {
      addComment(entry.body);
    }
  } else if (entry.kind === "reviewThread") {
    for (const comment of entry.thread.comments) {
      addComment(comment);
    }
  } else {
    addAuthor(entry.author);
  }
}

/** What the conversation images need from the conversation query's owner. */
export type ConversationImageOwner = {
  /** Owner scope of cached image bytes: the connection, so deleting it purges them. */
  readonly cacheScope: string;
  /** The conversation the query holds now. */
  readonly current: () => ConversationPage | null;
  /** Re-reads the conversation once, joining a read already in flight. */
  readonly refresh: () => Promise<void>;
};

/** The direct image sources of one rendered conversation page. */
export function conversationImageSources(
  page: ConversationPage,
  owner: ConversationImageOwner,
): DirectImageSources {
  const grants = conversationImageGrants(page);
  return {
    cacheScope: owner.cacheScope,
    grant: (reference) => grants.get(reference) ?? null,
    renew: async (reference, stale) => renewConversationImage(owner, reference, stale),
  };
}

/**
 * A fresh grant for `reference` after `stale` failed. When the query already holds another
 * URL for it (another image triggered the read), that URL is used without a new read;
 * otherwise the conversation is read once. The same stale URL is never handed out again.
 */
async function renewConversationImage(
  owner: ConversationImageOwner,
  reference: string,
  stale: DirectImageGrant,
): Promise<DirectImageGrant | null> {
  const known = conversationImageGrants(owner.current()).get(reference);
  if (known !== undefined && known.url !== stale.url) {
    return known;
  }
  await owner.refresh();
  const fresh = conversationImageGrants(owner.current()).get(reference);
  return fresh === undefined || fresh.url === stale.url ? null : fresh;
}
