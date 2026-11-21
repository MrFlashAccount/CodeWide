package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class AgentNotificationsTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)
  private val settings = AgentNotificationPreferences(context)
  private val alerts = AgentNotifications(context).apply { createChannel() }

  @Test fun defaultsShowQuietAnswersAndLeaveInputAndFailureToAndroid() {
    alerts.turnFinished("server", "one", false)
    alerts.turnFinished("server", "two", true)
    alerts.needsInput("server", "one", "request")
    val posted = manager.activeNotifications.associate { it.notification.extras.getString(Notification.EXTRA_TITLE) to it.notification }
    assertEquals(setOf("Agent turn completed", "Agent turn failed", "Agent needs your input"), posted.keys)
    val quiet = posted.getValue("Agent turn completed")
    assertEquals(Notification.GROUP_ALERT_SUMMARY, quiet.groupAlertBehavior)
    assertTrue(quiet.group != null)
    for (title in listOf("Agent turn failed", "Agent needs your input")) {
      val alert = posted.getValue(title)
      assertEquals(quiet.channelId, alert.channelId)
      assertEquals(Notification.GROUP_ALERT_ALL, alert.groupAlertBehavior)
    }
  }

  @Test fun masterSwitchSurvivesRestartAndRestoresIndependentChoices() {
    settings.setMode(AgentNotificationEvent.ANSWER, AgentNotificationMode.SYSTEM)
    settings.setMode(AgentNotificationEvent.INPUT, AgentNotificationMode.SILENT)
    settings.setMode(AgentNotificationEvent.FAILURE, AgentNotificationMode.OFF)
    settings.setEnabled(false)
    val restarted = AgentNotifications(context)
    restarted.turnFinished("server", "one", false)
    restarted.turnFinished("server", "two", true)
    restarted.needsInput("server", null, "request")
    assertTrue(manager.activeNotifications.isEmpty())
    AgentNotificationPreferences(context).setEnabled(true)
    restarted.turnFinished("server", "one", false)
    restarted.turnFinished("server", "two", true)
    restarted.needsInput("server", null, "request")
    val posted = manager.activeNotifications.map { it.notification }
    assertEquals(2, posted.size)
    assertEquals(Notification.GROUP_ALERT_SUMMARY, posted.single { it.extras.getString(Notification.EXTRA_TITLE) == "Agent needs your input" }.groupAlertBehavior)
    assertEquals(Notification.GROUP_ALERT_ALL, posted.single { it.extras.getString(Notification.EXTRA_TITLE) == "Agent turn completed" }.groupAlertBehavior)
    settings.setEnabled(false)
    restarted.cancelInput("server", "request")
    assertEquals(1, manager.activeNotifications.size)
  }
}
