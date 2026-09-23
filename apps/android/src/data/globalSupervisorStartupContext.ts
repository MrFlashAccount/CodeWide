import type { ThreadRealtimeInitialItem } from "@codewide/codex-protocol/v0.155.1/v2";

import type { GlobalSupervisorAttentionEvent } from "./globalSupervisorAttention";
import { globalSupervisorAttentionText } from "./globalSupervisorAttentionDelivery";

const MAX_CONVERSATION_ITEMS = 8;
const MAX_ITEM_CHARACTERS = 512;
const MAX_STARTUP_ITEMS = 16;
const MAX_STARTUP_CHARACTERS = 7000;

type ConversationItem = {
  readonly role: "assistant" | "user";
  readonly text: string;
};

type GlobalSupervisorStartupContextSnapshot = {
  readonly initialItems: ThreadRealtimeInitialItem[];
  readonly seededAttentionEventIds: ReadonlySet<string>;
};

export type GlobalSupervisorStartupContextOwner = {
  readonly acceptTranscript: (role: "assistant" | "user", text: string) => void;
  readonly snapshot: (
    pendingAttention: readonly GlobalSupervisorAttentionEvent[],
  ) => GlobalSupervisorStartupContextSnapshot;
};

function boundedText(text: string): string {
  const characters = Array.from(text);
  return characters.length <= MAX_ITEM_CHARACTERS
    ? text
    : characters.slice(characters.length - MAX_ITEM_CHARACTERS).join("");
}

/** Owns bounded authoritative conversation history for one logical voice activation. */
export function createGlobalSupervisorStartupContextOwner(): GlobalSupervisorStartupContextOwner {
  const conversation: ConversationItem[] = [];
  return {
    acceptTranscript(role, text) {
      conversation.push({ role, text: boundedText(text) });
      if (conversation.length > MAX_CONVERSATION_ITEMS) {
        conversation.splice(0, conversation.length - MAX_CONVERSATION_ITEMS);
      }
    },
    snapshot(pendingAttention) {
      const initialItems: ThreadRealtimeInitialItem[] = [];
      const seededAttentionEventIds = new Set<string>();
      let remainingCharacters = MAX_STARTUP_CHARACTERS;
      const append = (item: ThreadRealtimeInitialItem): boolean => {
        const size = Array.from(item.text).length;
        if (size === 0 || size > remainingCharacters || initialItems.length >= MAX_STARTUP_ITEMS) {
          return false;
        }
        initialItems.push(item);
        remainingCharacters -= size;
        return true;
      };
      for (const item of conversation) {
        append(item);
      }
      for (const event of pendingAttention) {
        if (append({ role: "developer", text: globalSupervisorAttentionText(event) })) {
          seededAttentionEventIds.add(event.eventId);
        }
      }
      return { initialItems, seededAttentionEventIds };
    },
  };
}
