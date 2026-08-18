/**
 * One scaling contract for every text surface in the Android application.
 *
 * Android windowed/DeX modes can change density and font scale without changing
 * the logical window size. Leaving React Native Text, HeroUI and text inputs on
 * different multipliers makes glyphs outgrow their measured containers.
 * Keep accessibility scaling enabled, but bound the dense work UI to a scale
 * that its icon controls and virtualized rows can accommodate.
 */
export const APP_MAX_FONT_SIZE_MULTIPLIER = 1.3;
