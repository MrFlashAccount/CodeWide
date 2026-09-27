# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# Scroll Report classifies these synchronous native adjustment paths. Preserve only
# this small diagnostic seam so release R8 names/inlining cannot hide its origin.
-keep,allowshrinking class com.facebook.react.views.scroll.MaintainVisibleScrollPositionHelper { *; }
-keep,allowshrinking class com.facebook.react.views.scroll.ReactScrollView {
    public void setContentOffset(...);
    public void scrollTo(...);
    protected void onLayout(...);
    public void onLayoutChange(...);
}
