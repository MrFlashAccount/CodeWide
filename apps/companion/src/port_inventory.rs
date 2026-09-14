//! Latest-value port inventory, independent of websocket and message processing.

use crate::ports::DiscoveredPort;
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::watch;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInventorySnapshot {
    pub revision: u64,
    pub ports: Vec<DiscoveredPort>,
    pub scanned_at: u64,
}

struct Inner {
    latest: watch::Sender<Option<Arc<PortInventorySnapshot>>>,
    started: AtomicBool,
    excluded: HashSet<u16>,
}

/// One scanner per Companion; subscribers retain at most the newest snapshot.
#[derive(Clone)]
pub struct PortInventory(Arc<Inner>);

impl PortInventory {
    #[must_use]
    pub fn new(excluded: HashSet<u16>) -> Self {
        let (latest, _) = watch::channel(None);
        Self(Arc::new(Inner {
            latest,
            started: AtomicBool::new(false),
            excluded,
        }))
    }

    /// Subscribing never waits for OS discovery, even on the first connection.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<Option<Arc<PortInventorySnapshot>>> {
        if self
            .0
            .started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            let weak = Arc::downgrade(&self.0);
            // OS/process discovery is blocking. A dedicated worker keeps it out
            // of Tokio's websocket executor and bounds concurrent scans to one.
            if let Err(err) = std::thread::Builder::new()
                .name("codewide-port-inventory".into())
                .spawn(move || {
                    let mut publisher = InventoryPublisher::default();
                    loop {
                        let Some(inner) = weak.upgrade() else {
                            break;
                        };
                        let ports = crate::ports::discover_blocking(&inner.excluded);
                        if let Some(snapshot) = publisher.observe(ports) {
                            inner.latest.send_replace(Some(Arc::new(snapshot)));
                        }
                        drop(inner);
                        std::thread::sleep(Duration::from_secs(1));
                    }
                })
            {
                self.0.started.store(false, Ordering::Release);
                tracing::error!(err = ?err, "Port inventory worker could not start");
            }
        }
        let mut receiver = self.0.latest.subscribe();
        // Reconnects get the current snapshot even when it has not changed.
        receiver.mark_changed();
        receiver
    }
}

#[derive(Default)]
struct InventoryPublisher {
    published: Option<Vec<DiscoveredPort>>,
    candidate: Option<Vec<DiscoveredPort>>,
    stable_samples: u8,
    revision: u64,
}

impl InventoryPublisher {
    fn observe(&mut self, ports: Vec<DiscoveredPort>) -> Option<PortInventorySnapshot> {
        if self.published.as_ref() == Some(&ports) {
            self.candidate = None;
            self.stable_samples = 0;
            return None;
        }
        if self.published.is_some() {
            if self.candidate.as_ref() == Some(&ports) {
                self.stable_samples += 1;
            } else {
                self.candidate = Some(ports);
                self.stable_samples = 1;
                return None;
            }
            if self.stable_samples < 5 {
                return None;
            }
        }
        self.revision += 1;
        // The publisher keeps a comparison baseline; subscribers own the snapshot.
        self.published = Some(ports.clone());
        self.candidate = None;
        self.stable_samples = 0;
        Some(PortInventorySnapshot {
            revision: self.revision,
            ports,
            scanned_at: crate::ports::unix_time_ms(),
        })
    }
}

/// A disabled subscription stays pending without allocating polling timers.
pub async fn next_inventory(
    receiver: &mut Option<watch::Receiver<Option<Arc<PortInventorySnapshot>>>>,
) -> Arc<PortInventorySnapshot> {
    let Some(receiver) = receiver else {
        return std::future::pending().await;
    };
    loop {
        if receiver.changed().await.is_err() {
            return std::future::pending().await;
        }
        if let Some(snapshot) = receiver.borrow_and_update().clone() {
            return snapshot;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(number: u16) -> DiscoveredPort {
        DiscoveredPort {
            port: number,
            name: "test".into(),
            group: "test".into(),
            details: String::new(),
            process: None,
            pid: None,
            cwd: None,
            kind: "test",
            forwarding_key: format!("test-{number}"),
            default_forwarding_enabled: false,
        }
    }

    #[test]
    fn publishes_initial_inventory_and_only_stable_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut publisher = InventoryPublisher::default();
        assert!(
            publisher
                .observe(vec![])
                .ok_or("expected inventory")?
                .ports
                .is_empty()
        );
        assert!(publisher.observe(vec![port(8080)]).is_none());
        assert!(publisher.observe(vec![]).is_none());
        for _ in 0..4 {
            assert!(publisher.observe(vec![port(8080)]).is_none());
        }
        let added = publisher
            .observe(vec![port(8080)])
            .ok_or("expected changed inventory")?;
        assert_eq!(added.ports[0].port, 8080);
        assert!(publisher.observe(vec![port(8080)]).is_none());
        for _ in 0..4 {
            assert!(publisher.observe(vec![]).is_none());
        }
        let removed = publisher.observe(vec![]).ok_or("expected inventory")?;
        assert!(removed.ports.is_empty());
        assert!(removed.revision > added.revision);
        Ok(())
    }

    #[tokio::test]
    async fn slow_subscriber_receives_latest_without_blocking_publisher() {
        let (sender, receiver) = watch::channel(None);
        let mut subscription = Some(receiver);
        for revision in 1..100 {
            sender.send_replace(Some(Arc::new(PortInventorySnapshot {
                revision,
                ports: vec![port(8080)],
                scanned_at: revision,
            })));
        }
        assert_eq!(next_inventory(&mut subscription).await.revision, 99);
    }
}
