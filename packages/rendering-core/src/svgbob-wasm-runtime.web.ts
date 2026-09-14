import { svgbobWasmBase64 } from "./svgbob-wasm.generated";

interface SvgbobExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  render(returnPointer: number, sourcePointer: number, sourceLength: number): void;
  __wbindgen_add_to_stack_pointer(offset: number): number;
  __wbindgen_malloc(size: number): number;
  __wbindgen_realloc(pointer: number, oldSize: number, newSize: number): number;
  __wbindgen_free(pointer: number, size: number): void;
};

// The bundled, generated module owns this ABI. Check its exported primitives
// before exposing the renderer contract; no foreign WASM module is accepted.
function isSvgbobExports(value: WebAssembly.Exports): value is SvgbobExports {
  return value["memory"] instanceof WebAssembly.Memory
    && typeof value["render"] === "function"
    && typeof value["__wbindgen_add_to_stack_pointer"] === "function"
    && typeof value["__wbindgen_malloc"] === "function"
    && typeof value["__wbindgen_realloc"] === "function"
    && typeof value["__wbindgen_free"] === "function";
}

let wasm: SvgbobExports | null = null;
let wasmPromise: Promise<SvgbobExports> | null = null;
let cachedBytes: Uint8Array | null = null;
let cachedInts: Int32Array | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });

async function svgbobExports(): Promise<SvgbobExports> {
  if (wasm !== null) return wasm;
  wasmPromise ??= WebAssembly.compile(decodeBase64(svgbobWasmBase64))
    .then((module) => WebAssembly.instantiate(module, {}))
    .then((instance) => {
      if (!isSvgbobExports(instance.exports)) throw new Error("Invalid bundled Svgbob exports");
      return instance.exports;
    });
  wasm = await wasmPromise;
  return wasm;
}

function decodeBase64(source: string): ArrayBuffer {
  const binary = globalThis.atob(source);
  const target = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) target[index] = binary.charCodeAt(index);
  return target.buffer;
}

function bytes(exports: SvgbobExports): Uint8Array {
  if (cachedBytes === null || cachedBytes.buffer !== exports.memory.buffer) cachedBytes = new Uint8Array(exports.memory.buffer);
  return cachedBytes;
}

function ints(exports: SvgbobExports): Int32Array {
  if (cachedInts === null || cachedInts.buffer !== exports.memory.buffer) cachedInts = new Int32Array(exports.memory.buffer);
  return cachedInts;
}

function passString(exports: SvgbobExports, source: string): { pointer: number; length: number } {
  let length = source.length;
  let pointer = exports.__wbindgen_malloc(length);
  const memory = bytes(exports);
  let offset = 0;
  while (offset < length) {
    const code = source.charCodeAt(offset);
    if (code > 0x7f) break;
    memory[pointer + offset] = code;
    offset += 1;
  }
  if (offset !== length) {
    const suffix = source.slice(offset);
    pointer = exports.__wbindgen_realloc(pointer, length, offset + suffix.length * 3);
    const target = bytes(exports).subarray(pointer + offset, pointer + offset + suffix.length * 3);
    const encoded = encoder.encodeInto(suffix, target);
    offset += encoded.written;
  }
  return { pointer, length: offset };
}

export async function renderSvgbob(source: string): Promise<string> {
  const exports = await svgbobExports();
  const returnPointer = exports.__wbindgen_add_to_stack_pointer(-16);
  let resultPointer = 0;
  let resultLength = 0;
  try {
    const input = passString(exports, source);
    exports.render(returnPointer, input.pointer, input.length);
    resultPointer = ints(exports)[returnPointer / 4] ?? 0;
    resultLength = ints(exports)[returnPointer / 4 + 1] ?? 0;
    return decoder.decode(bytes(exports).subarray(resultPointer, resultPointer + resultLength));
  } finally {
    exports.__wbindgen_add_to_stack_pointer(16);
    if (resultPointer !== 0 || resultLength !== 0) exports.__wbindgen_free(resultPointer, resultLength);
  }
}
