import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createWorkletRuntime,
  runOnRuntimeAsync,
  type WorkletRuntime,
} from "react-native-worklets";

import { checkAborted } from "../native/check-aborted";
import { MAX_INLINE_DIAGRAM_SOURCE_CHARS } from "./inlineMediaGeometry";
import { renderPeleDiagramSvg, type PeleDiagramRenderResult } from "./peleDiagramRenderer";

let peleRuntime: WorkletRuntime | null = null;

export function peleDiagramKey(source: string): string {
  return `pele-diagram:1.12.0:${bytesToHex(sha256(utf8ToBytes(source)))}`;
}

export async function renderPeleDiagram(
  source: string,
  signal: AbortSignal,
): Promise<PeleDiagramRenderResult> {
  checkAborted(signal);
  const result = await runOnRuntimeAsync(
    getPeleRuntime(),
    renderPeleDiagramSvg,
    source,
    MAX_INLINE_DIAGRAM_SOURCE_CHARS,
  );
  checkAborted(signal);
  return result;
}

function getPeleRuntime(): WorkletRuntime {
  peleRuntime ??= createWorkletRuntime({ name: "CodeWidePeleRenderer" });
  return peleRuntime;
}
