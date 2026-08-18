import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
const patch = readFileSync(new URL("../../../patches/@legendapp__list@3.3.5.patch", import.meta.url), "utf8");

describe("LegendList orientation anchor patch", () => {
  it("recalculates MVCP for both viewport axes and shrinking layouts", () => {
    expect(packageJson).toContain('"@legendapp/list@3.3.5": "patches/@legendapp__list@3.3.5.patch"');
    expect(patch.match(/^\+.*scrollLength !== previousLength/gm)).toHaveLength(4);
    expect(patch.match(/^\+.*otherAxisSize !== prevOtherAxisSize/gm)).toHaveLength(4);
    expect(patch).not.toContain("+  const needsCalculate = !state.lastLayout || scrollLength > state.scrollLength");
  });
});
