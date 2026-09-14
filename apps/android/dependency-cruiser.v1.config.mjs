import v2 from "./dependency-cruiser.v2.config.mjs";

const legacySource = "^src/(?!(?:v2|boot|presentation)/)";

/** V1 keeps its own architecture rules while sharing the Metro resolver with V2. */
export default {
  forbidden: [
    {
      name: "v1-no-circular-dependencies",
      severity: "error",
      comment: "V1 dependencies, including type contracts, must remain acyclic.",
      from: { path: legacySource },
      to: { circular: true },
    },
    {
      name: "v1-no-unresolved-dependencies",
      severity: "error",
      from: { path: legacySource },
      to: { couldNotResolve: true },
    },
    {
      name: "v1-does-not-import-v2",
      severity: "error",
      comment:
        "The generation bridge owns composition; V1 cannot import the V2 runtime or protocol.",
      from: { path: legacySource },
      to: { path: "^src/v2/|^@codewide/sync-client/v2$|(?:^|/)packages/sync-client/src/v2/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      ...v2.options.enhancedResolveOptions,
      // Type-only packages expose declarations instead of a JavaScript main file.
      extensions: [...v2.options.enhancedResolveOptions.extensions, ".d.ts"],
      mainFields: [...v2.options.enhancedResolveOptions.mainFields, "types", "typings"],
    },
    doNotFollow: v2.options.doNotFollow,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
