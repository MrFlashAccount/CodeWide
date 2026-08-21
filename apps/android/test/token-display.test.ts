import { describe, expect, it } from "vitest";

import { TOKEN_SYMBOL } from "../src/ui/token-display";

describe("token display", () => {
  it("uses the agreed lightweight token glyph", () => {
    expect(TOKEN_SYMBOL).toBe("⟡");
  });
});
