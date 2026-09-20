const { getDefaultConfig } = require("expo/metro-config");
const { realpathSync } = require("node:fs");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
const legendListNativeEntry = realpathSync(
  path.join(__dirname, "node_modules/@legendapp/list/react-native.js"),
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@legendapp/list/react-native") {
    return { filePath: legendListNativeEntry, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
