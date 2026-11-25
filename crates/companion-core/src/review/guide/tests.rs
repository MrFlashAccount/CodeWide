//! Guide parsing, catalog budget and re-matching fixtures.
#![allow(clippy::expect_used)]

use std::collections::HashMap;

use super::MAX_GUIDE_HUNKS;
use super::{
    GuideChapter, GuideStop, PendingGuide, ReviewGuide, StopState,
    catalog::{EXCERPT_PER_HUNK, alias_catalog},
    parse::{MAX_STOP_TEXT_CHARS, parse_guide},
    rematch,
};
use crate::review::{
    ReviewError,
    hunks::{HunkFingerprint, HunkId},
    source::{DiffCatalog, DiffSource, VcsReviewScope},
};

fn pending(count: usize) -> PendingGuide {
    PendingGuide {
        source: DiffSource::PullRequest {
            pull_request: "fpr1.x".into(),
        },
        request_id: "r".into(),
        idempotency_key: "k".into(),
        author_thread_id: "t".into(),
        revision: "rev".into(),
        aliases: (1..=count)
            .map(|index| HunkId::new("a.rs", index))
            .collect(),
    }
}

fn message(json: &str) -> String {
    format!("Here is the guide.\n```codewide-guide\n{json}\n```\n")
}

#[test]
fn a_valid_guide_maps_aliases_and_moves_omitted_hunks_to_support() {
    let guide = parse_guide(
        &message(r#"{"title":"T","summary":"S","chapters":[{"title":"C","summary":null,"stops":[{"title":"s","summary":"x","prose":null,"hunks":["h2"],"remarks":[{"hunk":"h2","side":"new","startLine":3,"endLine":4,"body":"check"}]}]}]}"#),
        &pending(3),
    )
    .expect("valid");
    assert_eq!(
        guide.chapters[0].stops[0].hunk_ids,
        vec![HunkId::new("a.rs", 2)]
    );
    assert_eq!(
        guide.support,
        vec![HunkId::new("a.rs", 1), HunkId::new("a.rs", 3)]
    );
    assert_eq!(guide.remarks.len(), 1);
}

#[test]
fn unknown_duplicate_empty_oversized_and_missing_guides_are_rejected() {
    let stop = |hunks: &str| {
        format!(
            r#"{{"title":"T","summary":"S","chapters":[{{"title":"C","stops":[{{"title":"s","summary":"x","hunks":{hunks}}}]}}]}}"#
        )
    };
    assert!(parse_guide(&message(&stop(r#"["h9"]"#)), &pending(3)).is_err());
    assert!(
        parse_guide(
            &message(r#"{"title":"T","summary":"S","chapters":[{"title":"C","stops":[{"title":"a","summary":"x","hunks":["h1"]},{"title":"b","summary":"y","hunks":["h1"]}]}]}"#),
            &pending(3)
        )
        .is_err()
    );
    assert!(
        parse_guide(
            &message(r#"{"title":"T","summary":"S","chapters":[]}"#),
            &pending(3)
        )
        .is_err()
    );
    let long = "x".repeat(MAX_STOP_TEXT_CHARS + 1);
    assert!(
        parse_guide(
            &message(&format!(r#"{{"title":"T","summary":"S","chapters":[{{"title":"C","stops":[{{"title":"s","summary":"{long}","hunks":["h1"]}}]}}]}}"#)),
            &pending(3)
        )
        .is_err()
    );
    assert!(parse_guide("no block here", &pending(3)).is_err());
    let twice = format!(
        "{}{}",
        message(&stop(r#"["h1"]"#)),
        message(&stop(r#"["h2"]"#))
    );
    assert!(parse_guide(&twice, &pending(3)).is_err());
}

fn catalog(revision: &str, hunks: &[(&str, &str)]) -> DiffCatalog {
    let mut files: Vec<crate::review::source::CatalogFile> = Vec::new();
    for (path, change) in hunks {
        let patch = format!("@@ -1 +1 @@\n-{change}\n+{change}!\n");
        let parsed = crate::review::hunks::parse_patch(path, &patch);
        match files.iter_mut().find(|file| file.path == *path) {
            Some(file) => {
                let ordinal = file.hunks.len() + 1;
                let mut parsed = parsed;
                for hunk in &mut parsed {
                    hunk.hunk.ordinal = ordinal;
                    hunk.hunk.id = HunkId::new(path, ordinal);
                }
                file.hunks.extend(parsed);
            }
            None => files.push(crate::review::source::CatalogFile {
                path: (*path).to_owned(),
                hunks: parsed,
            }),
        }
    }
    DiffCatalog {
        revision: revision.to_owned(),
        files,
    }
}

#[test]
fn catalogs_above_the_hunk_or_excerpt_budget_are_too_large() {
    let names: Vec<String> = (0..=MAX_GUIDE_HUNKS)
        .map(|index| format!("f{index}"))
        .collect();
    let hunks: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "x")).collect();
    assert!(matches!(
        alias_catalog(&catalog("r", &hunks)),
        Err(ReviewError::GuideTooLarge(count)) if count == MAX_GUIDE_HUNKS + 1
    ));
    let long = "y".repeat(EXCERPT_PER_HUNK);
    let wide: Vec<(&str, &str)> = names[..200]
        .iter()
        .map(|name| (name.as_str(), long.as_str()))
        .collect();
    assert!(matches!(
        alias_catalog(&catalog("r", &wide)),
        Err(ReviewError::GuideTooLarge(_))
    ));
    let (aliases, excerpt) = alias_catalog(&catalog("r", &hunks[..3])).expect("fits");
    assert_eq!(aliases.len(), 3);
    assert!(excerpt.contains("~~~untrusted-diff hunk=\"h3\" path=\"f2\""));
}

#[test]
fn stops_keep_moved_hunks_and_become_changed_when_a_hunk_is_gone() {
    let old = catalog("r1", &[("a.rs", "one"), ("b.rs", "two")]);
    let fingerprints: HashMap<HunkId, HunkFingerprint> = old
        .files
        .iter()
        .flat_map(|file| &file.hunks)
        .map(|parsed| (parsed.hunk.id.clone(), parsed.hunk.fingerprint.clone()))
        .collect();
    let mut guide = ReviewGuide {
        guide_id: "g".into(),
        source: DiffSource::PullRequest {
            pull_request: "fpr1.x".into(),
        },
        revision: "r1".into(),
        author_thread_id: "t".into(),
        created_at: String::new(),
        title: "T".into(),
        summary: "S".into(),
        chapters: vec![GuideChapter {
            chapter_id: "c".into(),
            title: "C".into(),
            summary: None,
            stops: vec![
                GuideStop {
                    stop_id: "moved".into(),
                    title: "m".into(),
                    summary: "m".into(),
                    prose: None,
                    hunk_ids: vec![HunkId::new("a.rs", 1)],
                },
                GuideStop {
                    stop_id: "gone".into(),
                    title: "g".into(),
                    summary: "g".into(),
                    prose: None,
                    hunk_ids: vec![HunkId::new("b.rs", 1)],
                },
            ],
        }],
        support: Vec::new(),
    };
    // The new revision moved `one` behind another hunk and dropped `two`.
    let new = catalog("r2", &[("a.rs", "zero"), ("a.rs", "one")]);
    let mut progress = HashMap::from([
        ("moved".to_owned(), StopState::Accepted),
        ("gone".to_owned(), StopState::Commented),
    ]);
    let changed = rematch(&mut guide, &fingerprints, &new, &mut progress);
    assert_eq!(changed, vec![("gone".to_owned(), StopState::Changed)]);
    assert_eq!(progress["moved"], StopState::Accepted);
    assert_eq!(
        guide.chapters[0].stops[0].hunk_ids,
        vec![HunkId::new("a.rs", 2)]
    );
}

#[test]
fn only_pull_request_guides_turn_remarks_into_drafts() {
    assert!(super::takes_remarks(&DiffSource::PullRequest {
        pull_request: "fpr1.key".into()
    }));
    assert!(!super::takes_remarks(&DiffSource::Vcs {
        workspace: "/w".into(),
        scope: VcsReviewScope::Uncommitted,
    }));
}
