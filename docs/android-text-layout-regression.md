# Android message text wrapping

`Давай выкатим апк` reproduced a missing final word on Android 15. The stored and copied message remained complete. Fabric reported one line, but the native TextView rendered only `Давай выкатим`.

Android 15 enables glyph-bound width measurement for TextView when targeting API 35+. React Native 0.86.2's TextLayoutManager measures advance widths. With Roboto Flex, the native view can therefore wrap at a width Fabric measured as a single line. The second line lies below the height assigned by Yoga. Disabling selection, changing break strategy, and disabling font padding did not fix the reproduction.

The application theme sets `android:useBoundsForWidth=false` to keep native TextView wrapping consistent with Fabric's measurement. This retains the existing font, intrinsic bubble width, accessibility scaling, selection and copying. The theme also reaches native text controls; the native composer and code presentation regressions run alongside this test. Canvas-based surfaces and WebView content keep their own layout policies.

Reference: [Android TextView.setUseBoundsForWidth](https://developer.android.com/reference/android/widget/TextView#setUseBoundsForWidth(boolean)). Revisit this compatibility setting when React Native changes its measurement policy; do not replace it with extra bubble padding or a JS height calculation.

## Regression and verification

`UserMessageTextLayoutTest` measures through the actual RN TextLayoutManager, lays out ReactTextView with the shipped theme and Roboto Flex, and verifies that every line ends inside the measured height. It covers Android 14/15, six densities, normal and enlarged text, tight and wider constraints, Cyrillic, Latin and explicit newlines. Tests load real application resources but use a plain Application to avoid booting JNI, WebRTC or process services.

```sh
sh scripts/android-gradle.sh :app:testDebugUnitTest
pnpm validate:android:v1
```

A minimal React Native bubble fixture on the API 35 phone emulator reproduced the missing word before the theme fix and displayed the entire phrase after installing the updated debug APK. A physical handset was not attached during this verification.
