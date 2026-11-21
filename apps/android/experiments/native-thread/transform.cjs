const fs = require("node:fs");
const crypto = require("node:crypto");
const upper = require(process.env.CW_UPSTREAM_BABEL);
const version = crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");
function replaceOnce(s, a, b) {
  if (s.split(a).length !== 2)
    throw new Error("Transcript experiment source differs from the supported viewport");
  return s.replace(a, b);
}
module.exports = {
  ...upper,
  getCacheKey: (...args) => upper.getCacheKey(...args) + version,
  transform(args) {
    if (
      /\/turns\/(PreTurnLifecycleRows|CompletedTurnHistory|ActiveTurnActivity)\.tsx$/.test(
        args.filename,
      )
    ) {
      const src = replaceOnce(
        args.src,
        'import { useRecyclingState } from "@legendapp/list/react-native";',
        'import { useLabRowState as useRecyclingState } from "../../../../experiments/native-thread/HostedTimeline";',
      );
      return upper.transform({ ...args, src });
    }
    if (!args.filename.endsWith("/timeline/TimelineViewportView.tsx")) return upper.transform(args);
    let src =
      'import {studyViewport} from "../../../../experiments/native-thread/Study";\n' + args.src;
    src = replaceOnce(
      src,
      "  return (\n    <RichMarkdownPremeasurementProvider",
      "  return studyViewport((\n    <RichMarkdownPremeasurementProvider",
    );
    src = replaceOnce(
      src,
      "    </RichMarkdownPremeasurementProvider>\n  );",
      "    </RichMarkdownPremeasurementProvider>\n  ), props, timelineRows);",
    );
    return upper.transform({ ...args, src });
  },
};
