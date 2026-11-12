/**
 * Forge-independent model of one authored message: Markdown plus attached
 * files. Producers map their own DTOs into it; renderers never see a forge,
 * thread or provider type.
 */
import type { UserMessageAttachment } from "../../rendering/user-message-attachments";

/** Authored Markdown and the files attached beside it. */
export type MessageContent = {
  readonly attachments: readonly UserMessageAttachment[];
  readonly markdown: string;
};

/** Who wrote a message; the avatar falls back to the login's initials. */
export type MessageAuthor = {
  readonly avatarUrl: string | null;
  readonly login: string;
  /** Marks an automation account (`bot`) or an AI reviewer (`ai`); `null` for a person. */
  readonly marker: "ai" | "bot" | null;
};

/** One read-only reaction: its emoji, how many reacted and whether the viewer did. */
export type MessageReaction = {
  readonly count: number;
  readonly emoji: string;
  readonly key: string;
  readonly viewerReacted: boolean;
};

/** How one reply write ended; a refused write never reached the server and keeps its text. */
export type MessageSendResult =
  | { readonly message: string; readonly status: "failed" }
  | { readonly status: "refused" }
  | { readonly status: "sent" };
