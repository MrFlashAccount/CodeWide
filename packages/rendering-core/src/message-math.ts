import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";

export type MessageMath = { readonly status: "ready"; readonly svg: string; readonly width: number; readonly height: number }
  | { readonly status: "invalid"; readonly source: string };

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/** Offline vector typesetting. No DOM, network font loading, HTML or require extensions. */
export function renderMessageMath(source: string, display: boolean, fontSize: number): MessageMath {
  try {
    // A fresh TeX instance prevents one message's macro definitions leaking into another.
    const document = mathjax.document("", {
      InputJax: new TeX({ packages: ["base", "ams", "newcommand"], maxBuffer: 32 * 1024, maxMacros: 1000 }),
      OutputJax: new SVG({ fontCache: "none" }),
    });
    const container = document.convert(source, { display, em: fontSize, ex: fontSize / 2, containerWidth: 80 * fontSize });
    const output = adaptor.outerHTML(container);
    const start = output.indexOf("<svg");
    const end = output.lastIndexOf("</svg>");
    if (start < 0 || end < 0 || output.includes('data-mml-node="merror"')) return { status: "invalid", source };
    const svg = output.slice(start, end + 6);
    const viewBox = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/u.exec(svg);
    if (viewBox === null) return { status: "invalid", source };
    const width = Number(viewBox[3]) * fontSize / 1000;
    const height = Number(viewBox[4]) * fontSize / 1000;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { status: "invalid", source };
    return { status: "ready", svg, width, height };
  } catch {
    return { status: "invalid", source };
  }
}
