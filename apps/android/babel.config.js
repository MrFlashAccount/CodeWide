const path = require("node:path");

module.exports = function configureBabel(api) {
  api.cache(true);

  const reactCompilerEscapeHatches = new Set([
    path.join(__dirname, "src/react/useEvent.ts"),
    path.join(__dirname, "src/react/useLatest.ts"),
  ]);

  return {
    presets: [
      [
        "babel-preset-expo",
        {
          "react-compiler": {
            // These two hooks deliberately implement event semantics beneath
            // the compiler's React rules. Keep their checked-in implementation
            // intact and compile every other inferred component/hook.
            sources: (filename) => !reactCompilerEscapeHatches.has(path.resolve(filename)),
            compilationMode: "infer",
            panicThreshold: "all_errors",
          },
        },
      ],
    ],
  };
};
