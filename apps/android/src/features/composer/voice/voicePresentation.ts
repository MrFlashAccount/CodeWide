/** V1 voicePresentation owner, extracted without changing interaction or resource lifetime. */

export function formatVoiceDuration(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}
