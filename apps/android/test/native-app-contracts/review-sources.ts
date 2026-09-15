import { readFileSync } from "node:fs";

export const codeReviewWorkspace = readFileSync(
  new URL("../../src/features/review/CodeReviewWorkspace.tsx", import.meta.url),
  "utf8",
);
export const ownerReviewSubmission = readFileSync(
  new URL("../../src/features/review/reviewSubmission.ts", import.meta.url),
  "utf8",
);
export const ownerCodeReviewResources = readFileSync(
  new URL("../../src/features/review/codeReviewResources.ts", import.meta.url),
  "utf8",
);
export const ownerReviewVoice = readFileSync(
  new URL("../../src/features/review/reviewVoice.ts", import.meta.url),
  "utf8",
);
export const ownerCodeReviewState = readFileSync(
  new URL("../../src/features/review/codeReviewState.ts", import.meta.url),
  "utf8",
);
export const reviewVoiceOwner = readFileSync(
  new URL("../../src/features/review/reviewVoice.ts", import.meta.url),
  "utf8",
);
