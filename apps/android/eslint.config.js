const babelParser = require("@babel/eslint-parser");
const reactHooks = require("eslint-plugin-react-hooks");
const presentationTokens = require("./eslint-presentation-tokens.cjs");
const v1Quality = require("./eslint-v1-quality.cjs");

const v1Files = ["app/legacy.tsx", "src/**/*.{js,jsx,ts,tsx}"];
const v1Ignores = ["src/boot/**", "src/presentation/**", "src/v2/**"];

module.exports = [
  {
    files: ["src/CodeWideScreen.tsx", "src/features/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}", "src/rendering/**/*.{ts,tsx}", "src/presentation/**/*.{ts,tsx}"],
    plugins: { codewide: { rules: { "presentation-tokens": presentationTokens } } },
    rules: { "codewide/presentation-tokens": "error" },
  },
  {
    ignores: ["android/**", "dist/**", ".expo/**"],
  },
  {
    files: v1Files,
    ignores: v1Ignores,
    plugins: {
      "codewide-v1": v1Quality,
    },
    rules: {
      "codewide-v1/imports-separated-from-code": "error",
      "codewide-v1/require-public-export-jsdoc": "error",
      "codewide-v1/stylesheet-properties-multiline": "error",
    },
  },
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: ["babel-preset-expo"],
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs.flat["recommended-latest"].rules,
  },
];
