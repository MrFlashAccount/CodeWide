package dev.codewide.app.remote

import java.lang.reflect.Modifier
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeServiceDiscoveryIsolationTest {
  @Test
  fun portDiscoveryDoesNotAcquireTheServiceMonitor() {
    // Cached inventory reads must remain independent of the service monitor
    // while connection recovery runs. This bridge keeps its legacy method name;
    // Kotlin internal methods also have a module-name suffix.
    val discovery = CodexConnectionService::class.java.declaredMethods.single {
      it.name.substringBefore('$') == "discoverPorts"
    }
    assertFalse(
      "Port discovery must not hold the service monitor across network I/O",
      Modifier.isSynchronized(discovery.modifiers),
    )
  }
}
