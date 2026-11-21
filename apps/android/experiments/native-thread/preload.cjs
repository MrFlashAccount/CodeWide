const Module = require("node:module"),
  path = require("node:path");
const std = Module._extensions[".js"];
Module._extensions[".js"] = function (m, f) {
  std(m, f);
  if (f !== path.join(process.env.CW_ROOT || "", "apps/android/metro.config.js")) return;
  const cfg = m.exports;
  process.env.CW_UPSTREAM_BABEL = cfg.transformer.babelTransformerPath;
  cfg.transformer.babelTransformerPath = path.join(__dirname, "transform.cjs");
};
