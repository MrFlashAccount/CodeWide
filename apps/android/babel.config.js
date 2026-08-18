module.exports = function configureBabel(api) {
  api.cache(true);

  return {
    presets: [
      [
        "babel-preset-expo",
        {
        "react-compiler": {
          // Compile React components and hooks. Application runtimes and
          // database adapters are deliberately ordinary imperative modules.
          compilationMode: "infer",
          panicThreshold: "all_errors",
        },
        },
      ],
    ],
  };
};
