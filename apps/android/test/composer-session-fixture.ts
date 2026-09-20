import type {
  ComposerSessionBinding,
  ComposerSessionOwner,
  ComposerSessionSnapshot,
} from "../src/features/composer/composerSession";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../src/data/thread-ui-state-types";

export const TEST_COMPOSER_PREFERENCES: StoredComposerPreferences = {
  effort: null,
  model: null,
  permissions: null,
  personality: null,
  sendMode: "start",
  skillPaths: [],
};

export function composerSessionFixture(
  plainText: string,
  preferences: StoredComposerPreferences = TEST_COMPOSER_PREFERENCES,
): ComposerSessionBinding {
  let current: ComposerSessionSnapshot = {
    attachments: [],
    markdown: plainText,
    plainText,
    preferences,
  };
  const owner: ComposerSessionOwner = {
    read: () => current,
    updateAttachments: (attachments: StoredDraftAttachment[]) => {
      current = { ...current, attachments };
    },
    updatePreferences: (apply) => {
      current = {
        ...current,
        preferences: apply(current.preferences),
      };
    },
    updateText: (text) => {
      current = { ...current, ...text };
    },
  };
  return {
    ...owner,
    capture: () => owner,
    get snapshot() {
      return current;
    },
  };
}
