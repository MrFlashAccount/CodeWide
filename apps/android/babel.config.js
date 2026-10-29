module.exports = function configureBabel(api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { "react-compiler": require("./react-compiler.config.cjs") }]],
    plugins: [
      [
        "react-native-worklets/plugin",
        {
          bundleMode: true,
          importForwarding: { moduleNames: ["pele"] },
          strictGlobal: true,
        },
      ],
    ],
  };
};
