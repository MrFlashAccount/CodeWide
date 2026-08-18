# CodeWide brand

**CodeWide** is an Android-first agentic IDE: one development workspace that is not bound to one device.

## Mark

The current primary mark is the **C/W monogram**: a wide `W` nested inside an open `C`. It gives the product name a compact signature without relying on a generic terminal glyph. This is the production mark for the current identity iteration; its geometry may be refined later without changing the CodeWide name.

- UI accent: `#5878FF`
- Graphite: `#0F0F10`
- Warm white: `#F4F4F5`
- Product spelling: `CodeWide`
- Short line: `One IDE. Everywhere.`

Use the mark without a container in monochrome system surfaces. Launcher and favicon use the warm-white mark on a graphite field; the UI accent is not an icon background. Do not recolor the mark with success, warning, or error colors.

Keep clear space of at least one stroke width around the mark. Below 16 px, use the mark only; do not use the wordmark.

## Asset map

- `codewide-app-icon.svg` and `codewide-app-icon-1024.png`: app-store/master icon.
- `codewide-mark*.svg`: UI, documentation, and splash mark.
- `codewide-wordmark*.svg`: light/dark README and marketing lockups.
- `codewide-menubar-template.svg` plus generated PNGs: future macOS menu bar template asset.
- `codewide-favicon.svg` and generated PNG: web/build-shelf identity.

`scripts/generate-codewide-assets.mjs` regenerates raster platform assets from these SVG masters.

## Compatibility boundary

Visible product labels use CodeWide. Existing package IDs, storage names, protocol discriminators, service unit names, and the legacy `codewide://` deep-link scheme remain stable until an explicit migration exists. New links may use `codewide://`; both schemes are accepted.
