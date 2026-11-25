const fs = require("node:fs");
const crypto = require("node:crypto");
const version = crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");

// Reuse the production viewport and every interaction owner. Only the emulator build uses this.
function openingWindowSource(source, replace) {
  const reading =
    "const reading = useThreadReadingPosition(props.draftConnectionId, props.draftThreadId);";
  let src = replace(source, reading, "");
  src = replace(
    src,
    "const timelineRows = placement.rows;",
    [
      reading,
      "const experiment = useOpeningWindow(props, placement.rows, reading, openingMode, traceOpening, afterBubbleFrame);",
      "const timelineRows = experiment.rows;",
    ].join("\n"),
  );
  src = replace(
    src,
    "    diagnostics.itemSizeChanged({",
    "    experiment.remember(event.itemData.key, event.size);\n    diagnostics.itemSizeChanged({",
  );
  src = replace(
    src,
    "  const listFooter = (",
    "  const windowReady = useEvent(() => experiment.ready(measurement.onReady));\n  const listFooter = (",
  );
  src = replace(src, "onReady={measurement.onReady}", "onReady={windowReady}");
  src = replace(
    src,
    "key={props.composerScope}",
    "key={props.composerScope + String(experiment.remount)}",
  );
  src = replace(
    src,
    "onScrollBeginDrag={gestures.onScrollBeginDrag}",
    "onTouchStart={experiment.partial ? experiment.expand : undefined}\n        onScrollBeginDrag={gestures.onScrollBeginDrag}",
  );
  src = replace(
    src,
    "onStartReached={props.loadOlderAtTimelineStart}",
    "onStartReached={experiment.partial && experiment.first > 0 ? undefined : props.loadOlderAtTimelineStart}",
  );
  src = replace(
    src,
    "onEndReached={props.loadNewerAtTimelineEnd}",
    "onEndReached={experiment.partial && experiment.last < placement.rows.length - 1 ? undefined : props.loadNewerAtTimelineEnd}",
  );
  src = replace(
    src,
    "    rows: timelineRows,\n    timelinePositioned:",
    "    rows: placement.rows,\n    timelinePositioned:",
  );
  return [
    'import { NativeModules as WindowModules } from "react-native";',
    'import { useOpeningWindow } from "../../../../experiments/native-thread/OpeningWindow";',
    "const openingMode = WindowModules.CodeWideNative.getConstants().threadLabMode;",
    "const traceOpening = (tag) => WindowModules.CodeWideLabOpeningWindow.mark(tag);",
    "const afterBubbleFrame = () => WindowModules.CodeWideLabOpeningWindow.afterBubbleFrame();",
    src,
  ].join("\n");
}

module.exports = { openingWindowSource, version };
