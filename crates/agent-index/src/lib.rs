//! The shared offset index of agent transcripts.
//!
//! A provider's transcript is an append-mostly JSONL file. This crate owns
//! what every such file needs and no format knows: the durable end and the
//! witness of a file's bytes ([`file`]), the redb tables that map a file to
//! its records, turn ranges, tombstones and materialized summaries
//! ([`store`]), the incremental forward scan, cold tail bootstrap, prefix
//! backfill and reverse boundary visitors ([`scan`]), and the debounced
//! watcher of files other processes write ([`monitor`]). The record format
//! is the provider's: it implements [`IndexSource`].

pub mod file;
pub mod monitor;
pub mod scan;
pub mod segment;
pub mod segment_store;
pub mod store;

pub use file::{FileWitness, file_id};
pub use scan::{
    Boundary, IndexError, IndexReport, IndexSource, IndexedTurnPage, SummaryProjection,
    TailScanReport, TurnRefReport,
};
pub use segment::{
    Observation, Record, RecordKeys, SegmentBoundary, SegmentReport, SegmentSource,
    SegmentSourceError, checkpoint_state, current_checkpoint, index_segments,
    reindex_segments_from, turn_resume_state,
};
pub use segment_store::{RecordSpan, SegmentStore, SegmentTables};
pub use store::{ContentEntry, FileState, IndexBatch, IndexStore, IndexTables, RecordRef, TurnRef};
