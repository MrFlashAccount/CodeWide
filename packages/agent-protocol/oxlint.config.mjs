import { libraryConfig } from "@sergeigarin/hygene";

/** Shared hygiene policy for the runtime-neutral protocol library. */
export default {
  ...libraryConfig,
  ignorePatterns: ["fixtures/**", "node_modules/**"],
};
