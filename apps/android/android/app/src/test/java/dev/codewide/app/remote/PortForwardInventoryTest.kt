package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class PortForwardInventoryTest {
  private val key = "a".repeat(64)

  @Test
  fun vanishedPortClosesItsListenerAndReturnsOnlyAfterDiscovery() {
    val fixture = InventoryFixture()
    val port = PortForwardInventoryEntry(3000, key, "Dev", true)
    fixture.reconcile(listOf(port))
    val first = fixture.store.list().single()
    assertTrue(fixture.running.contains(first.id))
    fixture.reconcile(emptyList())
    assertTrue(fixture.store.list().isEmpty())
    assertTrue(fixture.running.isEmpty())
    assertEquals(listOf("start:${first.id}", "close:${first.id}"), fixture.events)
    fixture.reconcile(listOf(port))
    assertEquals(1, fixture.running.size)
    assertEquals(3000, fixture.store.list().single().remotePort)
  }

  @Test
  fun serviceReplacementClosesOldForwardBeforeStartingNewOne() {
    val fixture = InventoryFixture()
    fixture.reconcile(listOf(PortForwardInventoryEntry(3000, key, "Dev", true)))
    val first = fixture.store.list().single().id
    fixture.reconcile(listOf(PortForwardInventoryEntry(3000, "b".repeat(64), "Other", true)))
    val replacement = fixture.store.list().single()
    assertEquals("b".repeat(64), replacement.serviceKey)
    assertEquals(listOf("start:$first", "close:$first", "start:${replacement.id}"), fixture.events)
  }

  @Test
  fun unchangedServiceRecoversAnUnavailableForwardWithoutChangingItsIdentity() {
    val fixture = InventoryFixture()
    val port = PortForwardInventoryEntry(3000, key, "Dev", true)
    fixture.reconcile(listOf(port))
    val first = fixture.store.list().single()
    fixture.unavailable.add(first.id)

    fixture.reconcile(listOf(port))

    assertEquals(first.id, fixture.store.list().single().id)
    assertEquals(first.serviceKey, fixture.store.list().single().serviceKey)
    assertEquals(listOf("start:${first.id}", "restart:${first.id}"), fixture.events)
    fixture.reconcile(listOf(port))
    assertEquals(2, fixture.events.size)
  }

  @Test
  fun exclusionSurvivesAbsenceAndRestartButNeverCreatesAGhostRow() {
    val policies = PortForwardPolicies()
    policies.set("server", key, "excluded")
    val first = InventoryFixture(policies)
    val port = PortForwardInventoryEntry(3000, key, "Dev", true)
    first.reconcile(listOf(port))
    assertEquals("excluded", first.store.list().single().preference)
    assertTrue(first.running.isEmpty())
    first.reconcile(emptyList())
    val restarted = InventoryFixture(PortForwardPolicies(policies.serialize()))
    assertTrue(restarted.store.list().isEmpty())
    restarted.reconcile(emptyList())
    assertTrue(restarted.store.list().isEmpty())
    restarted.reconcile(listOf(port))
    assertEquals("excluded", restarted.store.list().single().preference)
    assertTrue(restarted.running.isEmpty())
  }

  @Test
  fun defaultDisabledPortsWaitForAnExplicitIncludeAndPoliciesAreServerScoped() {
    val policies = PortForwardPolicies()
    val fixture = InventoryFixture(policies)
    val port = PortForwardInventoryEntry(3000, key, "System", false)
    fixture.reconcile(listOf(port))
    assertTrue(fixture.store.list().isEmpty())
    policies.set("server", key, "included")
    fixture.reconcile(listOf(port))
    assertEquals(1, fixture.running.size)
    assertEquals("automatic", policies.preference("other-server", key, 3000))
    assertTrue(NativePortForwardStore().list().isEmpty())
  }

  @Test
  fun legacyMigrationKeepsOnlyExplicitPolicyNotProfileState() {
    val rows = JSONArray()
      .put(JSONObject().put("connectionId", "server").put("serviceKey", key)
        .put("preference", "excluded").put("remotePort", 3000).put("enabled", false).put("label", "Old"))
      .put(JSONObject().put("connectionId", "server").put("serviceKey", "b".repeat(64))
        .put("preference", "automatic").put("remotePort", 4000).put("enabled", true))
      .put(JSONObject().put("connectionId", "server").put("serviceKey", JSONObject.NULL)
        .put("preference", "included").put("remotePort", 5000).put("enabled", true))
    val policies = PortForwardPolicies(legacy = JSONObject().put("profiles", rows).toString())
    val reopened = PortForwardPolicies(policies.serialize())
    assertEquals("excluded", reopened.preference("server", key, 3000))
    assertEquals("automatic", reopened.preference("server", "b".repeat(64), 4000))
    assertEquals("automatic", reopened.preference("server", "c".repeat(64), 5000))
    val saved = JSONObject(policies.serialize()).getJSONArray("policies")
    assertEquals(1, saved.length())
    assertFalse(saved.getJSONObject(0).has("enabled"))
    assertFalse(saved.getJSONObject(0).has("remotePort"))
  }

  @Test
  fun malformedScanIsRejectedBeforeReconciliation() {
    val row = JSONObject().put("port", 3000).put("forwardingKey", key)
      .put("name", "Dev").put("defaultForwardingEnabled", true)
    assertEquals(3000, parsePortForwardInventory(JSONArray().put(row)).single().port)
    assertThrows(IllegalArgumentException::class.java) {
      parsePortForwardInventory(JSONArray().put(row).put(row))
    }
    assertThrows(IllegalArgumentException::class.java) {
      parsePortForwardInventory(JSONArray().put(JSONObject(row.toString()).put("port", 3000.5)))
    }
  }
}

private class InventoryFixture(val policies: PortForwardPolicies = PortForwardPolicies()) {
  val store = NativePortForwardStore()
  val running = mutableSetOf<String>()
  val unavailable = mutableSetOf<String>()
  val events = mutableListOf<String>()
  private var sequence = 0
  private val reconciler = PortForwardInventoryReconciler(
    store, policies::preference,
    { connectionId, entry, existing, preference ->
      val id = existing?.id ?: "forward-${++sequence}"
      store.upsert(CurrentPortForward(id, connectionId, entry.label, entry.port, null,
        entry.serviceKey, preference, false, 1))
    },
    { id -> id in running && id !in unavailable },
    { id ->
      events.add("${if (id in running) "restart" else "start"}:$id")
      unavailable.remove(id)
      running.add(id)
      store.setEnabled(id, true)
    },
    { id -> running.remove(id); events.add("close:$id"); store.remove(id) },
  )
  fun reconcile(inventory: List<PortForwardInventoryEntry>) = reconciler.reconcile("server", inventory)
}
