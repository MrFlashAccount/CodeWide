# Message content

This feature owns the forge-independent model and rendering of one authored message, as the
[PR conversation contract](../../../../../docs/forge-conversation.md) defines it.

Public modules:

- `messageContent`: `MessageContent = { markdown, attachments }`, `MessageAuthor` (login,
  avatar and a `bot` / `ai` marker or `null`), `MessageReaction` and `MessageSendResult`.
  Producers map their own DTOs into these types.
- `MessageAvatar`: the round avatar through the private image path, with up to two initials of
  the login while there is no picture (no URL, loading or failed).
- `MessageAuthorName`: the login in header weight with a quiet `bot` / `AI` marker, spoken
  together.
- `MessageBody`: Markdown through the shared complete-document `CompleteMarkdown` (code, Mermaid,
  HTML, images) and attachments through `MessageAttachmentCard`. Remote images resolve through the
  nearest `DirectImageSourcesProvider` grant when the consumer mounts one, otherwise through the
  nearest `PrivateImageAccessProvider`; the consumer mounts both with its own media access.
- `MessageCard`: avatar (private image path, initials fallback), author name and marker,
  relative age, an edited mark, an optional owner-supplied badge, the body and the read-only
  reactions row (emoji, count, the viewer's own highlighted and spoken). A `continuation` card
  continues the previous message of the same author: no header, the body aligned under the
  previous text. It draws no frame; the owner groups cards.
- `MessageReplyInput`: the composer's public Markdown input with Send. Its typed text, pending
  state and failure live in one input-owned Legend model, so typing does not rerender the owner.
  While a write is pending the text stays in place and shimmers over the hidden, still-mounted
  editor; an acknowledged send remounts an empty editor; a failure stops the shimmer, restores
  the same editor content and shows the real error. A `refused` result (for example offline)
  keeps the text without an error; the owner explains the refusal. No spinner.

Boundaries: imports only `rendering/**`, `ui/**`, `theme`, `react/**`, `data` content and image
primitives (`private-transfer` types) and `features/composer/input/ComposerMarkdownInput`. It must
not import conversation, other composer modules, review or any forge/PR feature, and it must not
import forge data contracts. Reactions are read-only here; writes belong to the owner's `onSend`.
The chat, its bubbles and the chat composer do not use this feature and are unchanged by it.
