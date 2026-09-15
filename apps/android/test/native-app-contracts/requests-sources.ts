import { readFileSync } from "node:fs";

export const pendingRequestsProjection = readFileSync(
  new URL("../../src/features/requests/pendingRequests.ts", import.meta.url),
  "utf8",
);
