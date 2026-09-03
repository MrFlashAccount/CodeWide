import type {
  ComposerAttachmentTransport,
  LocalComposerAttachment,
} from "../../application/ports/composerAttachmentTransport";

export function createClosedComposerAttachmentTransport(): ComposerAttachmentTransport {
  return {
    createBytes: unavailableSelection,
    createText: unavailableSelection,
    pick: async () => unavailableSelection(),
    reference: () => {
      throw new Error("Composer attachments are available on Android only");
    },
    release: () => undefined,
    restore: () => null,
    upload: () => {
      throw new Error("Composer attachments are available on Android only");
    },
  };
}

function unavailableSelection(): LocalComposerAttachment {
  throw new Error("Composer attachments are available on Android only");
}
