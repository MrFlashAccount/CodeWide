# Companion semantic-search feasibility test — 2026-09-27

## Outcome

Local multilingual embeddings are worth a real-query pilot on Companion.
Julia is **not justified as a relevance reranker in the tested configuration**:
it degraded ranking severely and accepted unrelated passages. A dedicated
multilingual cross-encoder improved ranking, but its extra CPU latency is material.

This is an isolated Python experiment on the Companion host, **not an integrated
Rust endpoint, a production rollout, or a measured improvement to the Android UI**.
No production source, service configuration, or live index was changed.

## Controlled quality test

The fixture was authored and labelled before inference: 57 synthetic messages,
40 queries, including 36 answerable queries and four deliberately unanswerable
queries. The answerable set contains 22 Russian queries, ten English semantic
queries over Russian content, and four exact identifiers. It deliberately tests
paraphrases, negation, evidence, and proposed versus completed work. It does not
represent the frequency distribution of actual user searches.

| Method | Correct at rank 1 | Correct in top 5 | nDCG@5 | Candidate recall@20 |
| --- | ---: | ---: | ---: | ---: |
| Current AND-prefix / newest-first semantics | 4/36 | 4/36 | 0.111 | 4/36 |
| OR-prefix + BM25 lexical baseline | 14/36 | 21/36 | 0.487 | 27/36 |
| Multilingual E5-small | 25/36 | 34/36 | 0.833 | 36/36 |
| Equal-weight lexical/dense RRF | 21/36 | 33/36 | 0.767 | 35/36 |
| Same RRF candidates + Julia | 1/36 | 6/36 | 0.095 | 35/36 |
| Same RRF candidates + mMARCO cross-encoder | 29/36 | 35/36 | 0.897 | 35/36 |

The current search was designed for keywords, not these natural-language
questions: its 4/36 is not a claim that ordinary production search succeeds only
11% of the time. The stronger lexical baseline is included to test whether a
cheaper search change could be enough. All four exact identifiers were rank 1
for every method except Julia.

Important counterexamples to the original design assumptions:

- Naive equal-weight hybrid fusion was worse than dense retrieval alone and lost
  one correct candidate (`q16`). A reranker cannot recover a discarded answer.
- E5 put the locally built, unpublished APK above the published APK (`q03`).
  The dedicated cross-encoder also failed to put the published APK first.
  Better topical relevance does **not** establish reliable predicate execution.
- E5 ranked an unmeasured phone change first for a measured-jank query (`q02`).
  The dedicated reranker corrected that particular error.
- The no-answer requests must not receive ordinary ranking accuracy. Dense
  retrieval and the cross-encoder are not calibrated abstention mechanisms.

### Julia diagnosis

The fixed adapter asked whether each passage satisfied the original query,
with three descriptions: match, non-match, insufficient evidence. It used native
FP32 weights, a full decision head, strict 1,024-token encoding, and unrounded
softmax values from raw logits. No fixture was truncated.

For the 800 candidate/query pairs, argmax produced 30 true positives, 715 false
positives, 50 true negatives and five false negatives. These are diagnostics of
this adapter, not calibrated probabilities or a general Julia benchmark. All four
unanswerable queries received at least one `match`.

Post-hoc sanity checks were kept separate; the benchmark prompt and labels were
not tuned after results:

- The published billing example selected billing in its original option order.
- Across six permutations, it selected billing in four; two changed to shipping.
- An explicit unpublished-APK check selected the correct negative in only one
  of six permutations.
- An unrelated microphone-permission passage was accepted for an APK-publication
  search in all six permutations of the tested relevance options.
- The optimized runtime and the reference `TransformerEngine` agreed on all
  18 diagnostic decisions; maximum absolute logit difference was 0.0000358.
- The downloaded Julia weight SHA-256 matches the published checkpoint value.

This argues against a simple option-index or optimized-runtime wiring error.
It does not isolate a training cause or prove that every other Julia prompt,
typed API, language, or task would fail. Cross-passage comparison of these
saturated choice probabilities is not a useful relevance ordering here.

## Timing on actual local history

Read-only sample: 296 short assistant messages from 74 threads in this project,
split into 446 passages of at most 200 E5 tokens, with 12 unlabelled queries.
The experiment's own thread was excluded. Selection was bounded and stratified
by thread, not random or representative; long messages and user messages were
excluded. No recall or accuracy is assigned to this sample.

| Method | Median warm compute time | Observed maximum |
| --- | ---: | ---: |
| Current lexical semantics | 1.74 ms | 2.40 ms |
| OR-prefix + BM25 | 1.56 ms | 2.84 ms |
| E5 retrieval | 13.57 ms | 15.13 ms |
| Hybrid RRF | 15.27 ms | 17.47 ms |
| Hybrid + Julia | 2,413 ms | 2,957 ms |
| Hybrid + dedicated cross-encoder | 1,077 ms | 1,197 ms |

Reranked pipeline times sum the measured retrieval and reranking stages run in
separate processes. They are **not measured HTTP, IPC, network or UI latency**.
The candidate limit was 20 for both rerankers. Twelve samples are not a production
p95 estimate. The shared VM was not isolated from other workloads.

E5 indexed the 446 passages in 23.80 seconds. The resulting 384-dimensional FP32
vectors occupied 685,056 bytes, excluding metadata and any persistent ANN index.
Retrieval used an exact in-memory dot-product scan, not a full-history ANN index.
No per-keystroke reranking is recommended at the observed latency.

| Separate process | Model construction | Peak RSS including runtime |
| --- | ---: | ---: |
| E5 retrieval/indexing | 1.66 s | 1,226 MiB |
| Julia reranking | 3.89 s | 1,139 MiB |
| Dedicated reranker | 1.77 s | 998 MiB |

Construction time excludes Python/library imports, downloads and warmup; it is
not cold application startup. Import-only process peaks were approximately
325 MiB. These are separate process peaks, not incremental weights-only memory
and not the footprint of a combined resident deployment. The longer real passages
were noticeably more expensive than the short synthetic fixture.

Maximum observed input lengths on real data were 205 tokens for E5, 321 for
Julia and 218 for the cross-encoder. Inference rejects budget overflow instead
of silently truncating. Tokenizing whole messages before splitting emitted a
long-sequence warning; only the bounded chunks were passed to the model.

## Decision lanes

Actual evidence of pain is currently a source-level limitation (all-prefix AND)
plus this controlled test, not a labelled sample of Sergey's failed searches.

- **Incremental — CONDITIONAL:** OR/BM25 is the cheapest improvement and a useful
  fallback. It is insufficient for the cross-language and predicate cases here.
- **Structural — CONDITIONAL, preferred next experiment:** run E5 locally on
  Companion, retain exact keyword search, and evaluate a small real-query set.
  Do not assume equal-weight fusion is an improvement. Gate or explicitly request
  the costlier dedicated reranker; preserve source links and exact identifiers.
- **Julia relevance reranking — FAIL for this adapter:** no quality/cost reason
  to adopt it from the observed results. Other Julia use cases remain untested.
- **Radical — CONDITIONAL hypothesis:** derive a separate, source-linked index of
  decisions, proposals and completed actions, then search those records instead
  of interpreting arbitrary paragraphs on every query. Potential upside is better
  status-aware retrieval and lower interactive model cost. Risks are incorrect
  extraction, stale status and lost context. It is reversible if canonical history
  remains untouched. Cheapest test: manually label 100 source-linked records and
  compare 30 real queries before building an extraction pipeline.

The next adoption gate is 30–50 real queries labelled independently of model
outputs, with relevant source spans, hard negatives and no-answer cases. Compare
lexical, dense and optional reranking on the target host, including long histories,
incremental updates, deleted content, permissions, cancellation and lifecycle.
No current result authorizes production replacement or treats a similarity score
as a verified answer to “was this actually decided/completed?”.

## Reproduction and validation

See [README.md](README.md) for commands and [models.json](models.json) for immutable
model revisions. [results.json](results.json) records runtime versions, aggregate
quality and timing. [rankings.json](rankings.json) contains synthetic per-query top
five and relevant ranks. [julia-diagnostic.json](julia-diagnostic.json) records the
post-hoc checks. Private source text and source IDs remain outside the repository.

Fixture SHA-256:
`cd7ee72e0270c316bb4fb2fcf1f6d759d33050869f84bc87265e8cc927fb9513`.

Runtime: Python 3.12.3, PyTorch 2.14.0+cpu, Transformers 5.0.0, NumPy 2.2.6,
Safetensors 0.6.2, Hugging Face Hub 1.33.0, SentencePiece 0.2.1, Tokenizers 0.22.2.
Linux x86-64 shared AMD EPYC VM; four PyTorch threads, CPU FP32, no GPU or quantization.
Offline inference was separate from public artifact downloads.

Both standard transformer checkpoints contain legacy `position_ids` buffers that
Transformers 5 reports as unexpected. Their tensors were inspected and are the
standard sequential position arrays (512 and 514 positions respectively), not
missing learned weights. No missing-weight warning was reported.

All six synthetic and real-data stages completed. Local contract tests and Python
byte-compilation passed. No Android or Rust backend files changed, so their build
and release gates are outside this experiment; production integration is unverified.

Primary model sources: [Julia pinned model card](https://huggingface.co/SupersonicLabs/Julia-1/blob/a85b127321d580d65176c89ced8273f305745d85/README.md),
[multilingual E5-small](https://huggingface.co/intfloat/multilingual-e5-small),
[mMARCO cross-encoder](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1).
