# Native Ionicons assets

These Android vector drawables preserve the glyph outlines from the installed
`@expo/vector-icons` 15.1.1 `Ionicons.ttf` and its `glyphmaps/Ionicons.json`.
They are a bounded inventory of names used in Android application source, not
the entire upstream icon library. Existing matching `assets/menu-icons` assets
are reused by the catalog instead of copied.

Source font SHA-256:
`fa2ab7d2557819b2bfe5009e46844efa7170cf177be7735d43aa2ac1295f1d54`.

Conversion used FontTools 4.62.1 `TTFont`, `SVGPathPen`, and `TransformPen`.
For each name, the glyph-map codepoint selects the font's best cmap glyph.
The transform `(1, 0, 0, -1, 0, 448)` converts the font coordinates to the
512-by-512 icon viewport; 448 is this font's `OS/2.sTypoAscender`.
Transforms are baked into path coordinates because Expo's native XML loader
does not implement vector groups. Each asset uses one nonzero-filled path,
including all original contours, with no runtime parsing/conversion in JS.
The native Expo Icon still loads the bundled vector through its native loader.

Upstream: https://github.com/ionic-team/ionicons
License: https://github.com/ionic-team/ionicons/blob/main/LICENSE

## MIT License

Copyright (c) 2015-present Ionic (http://ionic.io/)
Copyright (c) 2015 Joel Arvidsson
Copyright (c) 2020 650 Industries

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
