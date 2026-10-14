//! Background tasks in a turn: the `taskNotification` item of a report
//! delivered to the conversation, and the sub-agent item a task's start and
//! report update. Part of [`TurnBuilder`]; see its ordering invariant 6.

use agent_core::model::{AgentEvent, ItemId, TaskNotificationDelivery};

use super::{ItemSlot, TurnBuilder};
use crate::transcript::{
    agents::{SubagentItem, notified_status, with_agent, with_status},
    frames::TaskStartedFrame,
    task_notifications::{Delivered, TaskIdentity, task_notification_item},
    task_reports::TaskReport,
};

impl TurnBuilder {
    /// A background task report delivered in this turn: `wake` reports lead
    /// a provider turn, `midTurn` ones sit where they arrived. Its id is the
    /// turn's report ordinal, so a replay of the stored history gives it the
    /// same id. It does not release the held agent message.
    pub fn add_task_notification(
        &mut self,
        report: &TaskReport,
        delivery: TaskNotificationDelivery,
        identity: TaskIdentity,
    ) -> Vec<AgentEvent> {
        let Some(item_id) = ItemId::parse(&format!(
            "{}:notification:{}",
            self.context.turn_id, self.notification_count
        )) else {
            return Vec::new();
        };
        self.notification_count += 1;
        let item = self.stamped(task_notification_item(
            report,
            Delivered {
                app_thread_id: &self.context.app_thread_id,
                delivery,
                identity,
                item_id: item_id.clone(),
            },
        ));
        self.slots.insert(
            item_id.clone(),
            ItemSlot {
                completed: true,
                item: item.clone(),
            },
        );
        self.order.push(item_id);
        vec![self.event_started(item.clone()), self.event_completed(item)]
    }

    /// Whether a tool call of this turn has started and not returned yet.
    #[must_use]
    pub fn is_open_tool_call(&self, tool_use_id: &str) -> bool {
        self.tools.contains_key(tool_use_id)
            && ItemId::parse(tool_use_id)
                .is_none_or(|item_id| self.slots.get(&item_id).is_none_or(|slot| !slot.completed))
    }

    /// The sub-agent item a task's spawning call started in this turn.
    fn subagent_slot(
        &mut self,
        tool_use_id: Option<&str>,
    ) -> Option<(&mut ItemSlot, SubagentItem)> {
        let item_id = tool_use_id.and_then(ItemId::parse)?;
        let slot = self.slots.get_mut(&item_id)?;
        let subagent = SubagentItem::from_item(&slot.item)?;
        Some((slot, subagent))
    }

    /// A sub-agent of this turn started: its item learns the agent thread.
    /// No event: the spawning call's completion carries the item.
    pub(super) fn on_task_started(&mut self, frame: &TaskStartedFrame) {
        let app_thread_id = self.context.app_thread_id.clone();
        let provenance = self.provenance.clone();
        if let Some((slot, subagent)) = self.subagent_slot(frame.tool_use_id.as_deref()) {
            slot.item = with_agent(subagent, &app_thread_id, &frame.task_id).into_item();
            // The rebuilt item lost its provenance stamp.
            slot.item.stamp(&provenance);
        }
    }

    /// A sub-agent of this turn reported: a returned spawning call's item
    /// takes its final status. No event: the turn's completion carries the
    /// item. The report's own item is the caller's to add
    /// ([`Self::add_task_notification`]).
    pub(super) fn on_task_reported(&mut self, report: &TaskReport) {
        let provenance = self.provenance.clone();
        let Some(status) = notified_status(report.status.as_deref()) else {
            return;
        };
        if let Some((slot, subagent)) = self.subagent_slot(report.tool_use_id.as_deref())
            && slot.completed
        {
            slot.item = with_status(subagent, status).into_item();
            slot.item.stamp(&provenance);
        }
    }
}
