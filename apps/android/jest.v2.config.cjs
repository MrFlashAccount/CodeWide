module.exports = {
  preset: "@react-native/jest-preset",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.render.test.tsx"],
  transform: {
    "^.+\\.(js|ts|tsx)$": [
      "babel-jest",
      { babelrc: false, configFile: false, presets: ["module:@react-native/babel-preset"] },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!.*(?:react-native|@react-native|expo|@expo))"],
};
