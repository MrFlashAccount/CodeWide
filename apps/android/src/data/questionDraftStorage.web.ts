/** Reads the local draft asynchronously, matching the native storage contract. */
export async function readQuestionDraft(key: string): Promise<string | null> {
  return Promise.resolve().then(() => localStorage.getItem(`codewide-question:${key}`));
}
/** Persists only sanitized form content; secret answers never reach this adapter. */
export async function writeQuestionDraft(key: string, value: string): Promise<void> {
  return Promise.resolve().then(() => {
    localStorage.setItem(`codewide-question:${key}`, value);
  });
}
