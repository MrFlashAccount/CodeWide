const path = require("node:path");

const escapeHatches = new Set([
  path.join(__dirname, "src/react/useEvent.ts"),
  path.join(__dirname, "src/react/useLatest.ts"),
]);

// Production and render tests must compile the same application sources.
module.exports = {
  sources: (filename) => {
    const resolved = path.resolve(filename);
    return (resolved.startsWith(path.join(__dirname, "src") + path.sep) ||
      resolved.startsWith(path.join(__dirname, "app") + path.sep)) &&
      !escapeHatches.has(resolved);
  },
  compilationMode: "infer",
  panicThreshold: "all_errors",
};
