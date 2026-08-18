const babelParser = require("@babel/eslint-parser");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = [
  {
    ignores: ["android/**", "dist/**", ".expo/**"],
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
