/** Prompt offers built from user content. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promptContent } from "../src/threads/prompt.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]);

describe("local image prompt content", () => {
  it("types a companion attachment without an extension by its content", () => {
    const directory = mkdtempSync(join(tmpdir(), "claude-agent-host-prompt-"));
    const path = join(directory, "mv2wp6mz-1ykav8ev-image:9185");
    writeFileSync(path, JPEG);

    expect(promptContent([{ path, type: "localImage" }])).toEqual([
      {
        source: { data: JPEG.toString("base64"), media_type: "image/jpeg", type: "base64" },
        type: "image",
      },
    ]);
  });

  it("describes a file that is not a supported image instead of failing the turn", () => {
    const directory = mkdtempSync(join(tmpdir(), "claude-agent-host-prompt-"));
    const path = join(directory, "notes.png");
    writeFileSync(path, "plain text");

    expect(promptContent([{ path, type: "localImage" }])).toEqual([
      { text: `[Attached image could not be read: ${path}]`, type: "text" },
    ]);
  });
});
