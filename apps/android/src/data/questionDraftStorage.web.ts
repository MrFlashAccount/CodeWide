const deletedPrefixes = new Set<string>();

function isDeletedKey(key: string): boolean {
  for (const prefix of deletedPrefixes) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/** Reads the local draft asynchronously, matching the native storage contract. */
export async function readQuestionDraft(key: string): Promise<string | null> {
  return Promise.resolve().then(() =>
    isDeletedKey(key) ? null : localStorage.getItem(`codewide-question:${key}`),
  );
}
/** Persists only sanitized form content; secret answers never reach this adapter. */
export async function writeQuestionDraft(key: string, value: string): Promise<void> {
  return Promise.resolve().then(() => {
    if (!isDeletedKey(key)) {
      localStorage.setItem(`codewide-question:${key}`, value);
    }
  });
}

export async function deleteConnectionQuestionDrafts(connectionId: string): Promise<void> {
  const ownerPrefix = `[${JSON.stringify(connectionId)},`;
  deletedPrefixes.add(ownerPrefix);
  await Promise.resolve();
  const prefix = `codewide-question:${ownerPrefix}`;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key !== null && key.startsWith(prefix)) {
      localStorage.removeItem(key);
    }
  }
}
