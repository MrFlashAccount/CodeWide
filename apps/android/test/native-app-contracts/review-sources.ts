import { readFileSync } from "node:fs";

export const codeReviewWorkspace = readFileSync(
  new URL("../../src/features/review/workspace/CodeReviewWorkspace.tsx", import.meta.url),
  "utf8",
);
export const ownerReviewSubmission = readFileSync(
  new URL("../../src/features/review/comments/reviewSubmission.ts", import.meta.url),
  "utf8",
);
export const ownerCodeReviewResources = readFileSync(
  new URL("../../src/features/review/workspace/codeReviewResources.ts", import.meta.url),
  "utf8",
);
export const ownerReviewVoice = readFileSync(
  new URL("../../src/features/review/comments/reviewVoice.ts", import.meta.url),
  "utf8",
);
export const ownerCodeReviewState = readFileSync(
  new URL("../../src/features/review/workspace/codeReviewState.ts", import.meta.url),
  "utf8",
);
export const ownerCodeReviewMenu = readFileSync(
  new URL("../../src/features/review/workspace/codeReviewMenu.ts", import.meta.url),
  "utf8",
);
export const reviewVoiceOwner = readFileSync(
  new URL("../../src/features/review/comments/reviewVoice.ts", import.meta.url),
  "utf8",
);
