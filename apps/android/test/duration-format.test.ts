import { expect, it } from "vitest";
import { formatDuration } from "../src/ui/number-format";

it.each([
  [0, "0 ms"],
  [125, "125 ms"],
  [999, "999 ms"],
  [1_000, "1.0 s"],
  [12_345, "12.3 s"],
  [59_000, "59.0 s"],
])("keeps short duration precision for %s milliseconds", (milliseconds, label) => {
  expect(formatDuration(milliseconds)).toBe(label);
});

it.each([
  [60_000, "1m"],
  [606_000, "10m 6s"],
  [18_000_000, "5h"],
  [36_615_000, "10h 10m 15s"],
  [93_784_000, "1d 2h 3m 4s"],
  [172_800_000, "2d"],
  [3_601_000, "1h 1s"],
])("composes nonzero duration units for %s milliseconds", (milliseconds, label) => {
  expect(formatDuration(milliseconds)).toBe(label);
});

it.each([
  [59_999, "1m"],
  [119_600, "2m"],
  [3_599_500, "1h"],
  [86_399_500, "1d"],
])("carries rounded seconds into the next unit for %s milliseconds", (milliseconds, label) => {
  expect(formatDuration(milliseconds)).toBe(label);
});
