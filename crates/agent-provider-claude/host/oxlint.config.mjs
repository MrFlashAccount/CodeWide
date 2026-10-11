import { defineHygieneConfig } from "@sergeigarin/hygene";

/** Shared hygiene policy for the Node runtime of the Claude agent host. */
export default {
  ...defineHygieneConfig({ environment: "node", typeCheck: true }),
  ignorePatterns: ["dist/**", "node_modules/**", "test/fixtures/**", "test/golden/**"],
};
