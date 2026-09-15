import { defineHygieneConfig } from "@sergeigarin/hygene";

const base = defineHygieneConfig({
  environment: "universal",
  typeCheck: true,
});

/** Full shared hygiene policy scoped to the V1 Android implementation. */
export default {
  ...base,
  globals: {
    EventSource: "readonly",
    WebSocket: "readonly",
    fetch: "readonly",
    indexedDB: "readonly",
    localStorage: "readonly",
    sessionStorage: "readonly",
  },
  ignorePatterns: [
    ".expo/**",
    "android/**",
    "assets/**",
    "coverage/**",
    "dist/**",
    "node_modules/**",
    "src/boot/**",
    "src/presentation/**",
    "src/v2/**",
  ],
};
