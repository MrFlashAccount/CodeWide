package dev.codewide.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val PACKAGE_NAME = "dev.codexremote.app"

@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun startup() = rule.collect(
        packageName = PACKAGE_NAME,
        // The React Native cold-start trace spans tens of thousands of app and
        // dependency rules. Treating all of it as startup-critical makes D8
        // force an oversized, non-minified working set toward the primary dex.
        // Keep the trace as an ART baseline profile; dex layout stays with D8/R8.
        includeInStartupProfile = false,
    ) {
        pressHome()
        startActivityAndWait()
        device.waitForIdle()
    }
}
