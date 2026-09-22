/** Generated from crates/companion-core/contract/v1.json globalSupervisorLimitsV1. */
const dynamicToolInputMaxBytes = 65_536;
const dynamicToolOutputMaxBytes = 262_144;
const eventCoalescingMaxDistinctSources = 32;
const eventCoalescingWindowMs = 2000;
const interruptionAckTimeoutMs = 2000;
const listChatsPageMaxEntries = 100;
const liveChannelMaxBytes = 4_194_304;
const liveChannelMaxEnvelopes = 256;
const liveEnvelopeMaxBytes = 262_144;
const microphoneInputBufferMaxBytes = 262_144;
const microphoneInputBufferMaxDurationMs = 2000;
const outputPlaybackBufferMaxBytes = 524_288;
const outputPlaybackBufferMaxDurationMs = 5000;
const readChatPageMaxBytes = 262_144;
const readChatPageMaxItems = 100;
const realtimeStartupTimeoutMs = 15_000;
const realtimeStopCloseTimeoutMs = 5000;

/** Generated V1 supervisor limits shared with the Companion contract. */
export const globalSupervisorLimitsV1 = {
  dynamicToolInputMaxBytes,
  dynamicToolOutputMaxBytes,
  eventCoalescingMaxDistinctSources,
  eventCoalescingWindowMs,
  interruptionAckTimeoutMs,
  listChatsPageMaxEntries,
  liveChannelMaxBytes,
  liveChannelMaxEnvelopes,
  liveEnvelopeMaxBytes,
  microphoneInputBufferMaxBytes,
  microphoneInputBufferMaxDurationMs,
  outputPlaybackBufferMaxBytes,
  outputPlaybackBufferMaxDurationMs,
  readChatPageMaxBytes,
  readChatPageMaxItems,
  realtimeStartupTimeoutMs,
  realtimeStopCloseTimeoutMs,
  version: 1,
} as const;
