const MIN_AUDIO_LEVEL = 0;
const MAX_AUDIO_LEVEL = 1;

type UnknownStatsReport = {
  readonly forEach: (visitor: (entry: unknown) => void) => void;
};

type UnknownStatsEntry = {
  readonly audioLevel?: unknown;
  readonly bytesSent?: unknown;
  readonly kind?: unknown;
  readonly mediaType?: unknown;
  readonly packetsSent?: unknown;
  readonly type?: unknown;
};

/** Content-free counters proving how far microphone media progressed through WebRTC. */
export type GlobalVoiceWebRtcTransportSnapshot = {
  readonly outboundAudioBytes: number;
  readonly outboundAudioPackets: number;
};

function isUnknownStatsEntry(entry: unknown): entry is UnknownStatsEntry {
  return typeof entry === "object" && entry !== null;
}

function isInboundAudioEntry(entry: UnknownStatsEntry): boolean {
  if (entry.type !== "inbound-rtp") {
    return false;
  }
  return entry.kind === "audio" || entry.mediaType === "audio";
}

function isOutboundAudioEntry(entry: UnknownStatsEntry): boolean {
  if (entry.type !== "outbound-rtp") {
    return false;
  }
  return entry.kind === "audio" || entry.mediaType === "audio";
}

function nonNegativeCounter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundedAudioLevel(level: unknown): number | null {
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return null;
  }
  return Math.max(MIN_AUDIO_LEVEL, Math.min(MAX_AUDIO_LEVEL, level));
}

function entryPlaybackLevel(entry: unknown): number | null {
  if (!isUnknownStatsEntry(entry)) {
    return null;
  }
  if (!isInboundAudioEntry(entry)) {
    return null;
  }
  return boundedAudioLevel(entry.audioLevel);
}

function isUnknownStatsReport(report: unknown): report is UnknownStatsReport {
  return (
    typeof report === "object" &&
    report !== null &&
    "forEach" in report &&
    typeof report.forEach === "function"
  );
}

/** Reads the bounded remote-audio level exposed by an inbound WebRTC stats report. */
export function globalVoiceWebRtcPlaybackLevel(report: unknown): number {
  if (!isUnknownStatsReport(report)) {
    return MIN_AUDIO_LEVEL;
  }
  let result = MIN_AUDIO_LEVEL;
  report.forEach((entry: unknown) => {
    const level = entryPlaybackLevel(entry);
    if (level !== null) {
      result = Math.max(result, level);
    }
  });
  return result;
}

/** Reads aggregate microphone RTP counters without retaining payloads or user content. */
export function globalVoiceWebRtcTransportSnapshot(
  report: unknown,
): GlobalVoiceWebRtcTransportSnapshot {
  if (!isUnknownStatsReport(report)) {
    return { outboundAudioBytes: 0, outboundAudioPackets: 0 };
  }
  let outboundAudioBytes = 0;
  let outboundAudioPackets = 0;
  report.forEach((entry: unknown) => {
    if (!isUnknownStatsEntry(entry) || !isOutboundAudioEntry(entry)) {
      return;
    }
    outboundAudioBytes += nonNegativeCounter(entry.bytesSent);
    outboundAudioPackets += nonNegativeCounter(entry.packetsSent);
  });
  return { outboundAudioBytes, outboundAudioPackets };
}
