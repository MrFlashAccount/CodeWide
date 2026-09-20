const MIN_AUDIO_LEVEL = 0;
const MAX_AUDIO_LEVEL = 1;

type UnknownStatsReport = {
  readonly forEach: (visitor: (entry: unknown) => void) => void;
};

function entryAudioLevel(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const type = "type" in entry ? entry.type : undefined;
  const level = "audioLevel" in entry ? entry.audioLevel : undefined;
  if (type !== "media-source" || typeof level !== "number" || !Number.isFinite(level)) {
    return null;
  }
  return Math.max(MIN_AUDIO_LEVEL, Math.min(MAX_AUDIO_LEVEL, level));
}

function isUnknownStatsReport(report: unknown): report is UnknownStatsReport {
  return (
    typeof report === "object" &&
    report !== null &&
    "forEach" in report &&
    typeof report.forEach === "function"
  );
}

/** Reads the bounded microphone level exposed by a WebRTC media-source stats report. */
export function globalVoiceWebRtcAudioLevel(report: unknown): number {
  if (!isUnknownStatsReport(report)) {
    return MIN_AUDIO_LEVEL;
  }
  let result = MIN_AUDIO_LEVEL;
  report.forEach((entry: unknown) => {
    const level = entryAudioLevel(entry);
    if (level !== null) {
      result = Math.max(result, level);
    }
  });
  return result;
}
