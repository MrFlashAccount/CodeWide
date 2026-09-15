import { readFileSync } from "node:fs";

export const voiceController = readFileSync(
  new URL("../../src/data/voice-input-controller.ts", import.meta.url),
  "utf8",
);
export const ownerVoiceTransport = readFileSync(
  new URL("../../src/data/voice-transport.ts", import.meta.url),
  "utf8",
);
