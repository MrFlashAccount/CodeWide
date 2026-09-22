module.exports = {
  // WHY: React Native host views require the framework's Node test runtime.
  preset: "@react-native/jest-preset",
  rootDir: ".",
  testMatch: ["<rootDir>/test/native-markup.native.test.tsx"],
  transform: {
    "^.+\\.(js|ts|tsx)$": ["babel-jest", {
      babelrc: false, configFile: false, presets: ["module:@react-native/babel-preset"],
      // The production lazy import remains lazy; Jest executes its equivalent CommonJS promise.
      plugins: [
        [require.resolve("babel-plugin-react-compiler", { paths: [require.resolve("babel-preset-expo")] }), require("./react-compiler.config.cjs")],
        "@babel/plugin-transform-dynamic-import",
      ],
    }],
  },
  transformIgnorePatterns: ["node_modules/(?!.*(?:react-native|@native-html|@jsamr|marked|decode-named-character-reference|stringify-entities|character-entities|character-reference|is-alphabetical|is-decimal|is-hexadecimal|is-alphanumerical))"],
};
