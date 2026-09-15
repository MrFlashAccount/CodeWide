import { readFileSync } from "node:fs";

export const settingsSheet = readFileSync(
  new URL("../../src/features/settings/SettingsSheet.tsx", import.meta.url),
  "utf8",
);
