# Fixed 30% Julia filter and E5 footprint — 2026-09-27

## Outcome

The lexical/dense retrieval plus optional semantic judging architecture is
plausible. The specific policy **hide a result when Julia assigns positive
probability below 0.30 fails this exploratory test**. More explicit binary prompts
removed more irrelevant candidates, but also discarded too many relevant results.
Sorting by the resulting probabilities further degraded ranking.

This does not establish that every possible Julia prompt will fail, and says
nothing about Jev's quality: Jev was not run. Julia and Jev have similar typed
decision interfaces, but are independently trained models. Success of one is not
evidence for the other.

The production app, backend and index remain unchanged. The follow-up only adds
an isolated experiment and its synthetic evidence.

## Protocol

[FILTER_PROTOCOL.md](FILTER_PROTOCOL.md) and [filter_prompts.py](filter_prompts.py)
were fixed before inference. Three adapters were compared:

- Original English three-way `choice`: match, non-match, insufficient evidence.
- English binary `noul`: descriptive false/true options; query and passage in state.
- Equivalent Russian binary `noul`.

Every adapter retains scores **greater than or equal to 0.30**. No threshold was
fitted, and no prompts were revised after observing these results. Both filter-only
and filter-plus-rerank policies use identical hybrid top-20 candidate membership.
No gold document was injected. The native Julia runtime uses strict 1,024-token
encoding, full decision head, CPU FP32 and four PyTorch threads.

The old fixture is a seen exploratory set. A fresh fixture of 32 synthetic passages
and 16 queries (12 answerable, four unanswerable) was authored and labelled before
running these prompts. It is **not** an independent human-labelled or representative
benchmark. Raw predictions are saved separately outside the repository.

## Filtering results

Fresh synthetic set, 320 query/candidate pairs: 12 relevant and 308 irrelevant.
All 12 relevant results were present before filtering.

| Prompt | Relevant results wrongly dropped | Irrelevant candidates removed | Correct answer in top 5 after filtering | After filtering and reranking |
| --- | ---: | ---: | ---: | ---: |
| No Julia filter | 0/12 | 0/308 | 12/12 | Not applicable |
| Original three-way choice | 1/12 | 14/308 | 11/12 | 6/12 |
| English binary question | 4/12 | 124/308 | 8/12 | 3/12 |
| Russian binary question | 2/12 | 116/308 | 10/12 | 4/12 |

All three adapters still kept candidates on every one of the four no-answer
queries. A nonempty list is normal for ungated retrieval; it becomes a problem
if these decisions are presented as proof that an answer exists.

Original seen set, 800 pairs: 35 relevant and 765 irrelevant. One of its 36 relevant
answers was already missed by retrieval and is not counted as a Julia rejection.

| Prompt | Relevant results wrongly dropped | Irrelevant candidates removed | Correct answer in top 5 after filtering |
| --- | ---: | ---: | ---: |
| No Julia filter | 0/35 | 0/765 | 33/36 |
| Original three-way choice | 4/35 | 27/765 | 29/36 |
| English binary question | 12/35 | 217/765 | 22/36 |
| Russian binary question | 12/35 | 334/765 | 23/36 |

These counts show that wording and request type matter, but do not support the
assumption that a low score safely identifies irrelevant text. Examples from
the fresh fixture:

- The English binary prompt assigned approximately 0.012% to a passage explicitly
  saying that viewing is allowed and changes are forbidden, for a query asking
  where read-only access had already been enabled (`f01`).
- The Russian binary prompt assigned approximately 11.1% to the correct passage
  saying a backup file exists but restoration has not been tested (`f12`).

Softmax probability is not demonstrated to be a calibrated relevance probability.
Rejection precision alone is misleading here because most candidate pairs are
irrelevant even before filtering. Relevant-result retention and no-answer behavior
must be checked separately.

On the short fresh passages, median Julia judging time for 20 candidates was
1.18 seconds for the original prompt, 1.17 seconds for English binary and 1.38
seconds for Russian binary, excluding retrieval and transport. The original
experiment's longer real passages took about 2.4 seconds with its original prompt;
the new binary prompts were not measured on private history.

## How lightweight is E5-small?

Measured from the pinned local artifacts and a fresh isolated E5 process:

| Property | Measurement |
| --- | ---: |
| Floating-point parameter elements | 117,653,760, approximately 118M |
| FP32 safetensors file | 470,641,600 bytes, 448.84 MiB |
| Python process RSS after imports | 324.07 MiB |
| RSS after model construction | 898.50 MiB |
| RSS after warmup and 16 short queries | 996.93 MiB |
| Median short-query encoding | 15.56 ms |
| Output vector | 384 FP32 values, 1,536 bytes |

The earlier real-data indexing run peaked at 1,226 MiB. These numbers include
Python/PyTorch/tokenizer/activations and are not just model weights. They are not
measurements of a Rust/ONNX deployment. This profile ran on a shared Linux VM;
the Julia probe was also executing, so the query timing is not an isolated SLO.
The process used CPU FP32, four PyTorch threads, no GPU and no quantization.

For comparison, the pinned Julia weights occupy 550.45 MiB and contain about
144.3M floating-point elements. E5 is not orders of magnitude smaller in weights.
Its search-time advantage comes importantly from precomputing passage vectors:
only the query must be encoded, whereas the tested Julia role reads each
query/passage pair again.

Storage arithmetic, not a large-scale benchmark:
`100,000 passages * 384 dimensions * 4 bytes = 153,600,000 bytes`, approximately
146.5 MiB of raw vectors. This excludes search-index overhead, metadata and text.
Quantized weights, runtime footprint and quality have not been tested.

## Product boundary and decision lanes

- **Incremental — CONDITIONAL:** retain exact search and add an optional dense
  result surface. Validate relevance on actual user queries; do not hide hits.
- **Structural — CONDITIONAL:** lexical and E5 retrieval should independently
  contribute candidates before any optional judge. Running E5 only on lexical
  matches defeats discovery without shared words. Fusion, a dedicated reranker
  or Julia must each prove additive value. The tested Julia 0.30 hard gate is FAIL.
- **Radical — CONDITIONAL hypothesis:** precompute source-linked decision/status
  records when indexing instead of evaluating those fixed predicates at query
  time. Potential gain is lower interactive cost; risks are extraction mistakes
  and stale state. Keep canonical messages so it is reversible. The cheapest
  falsification is a small manually labelled record/query set before implementing
  an extraction service. This does not precompute arbitrary future relevance.

Next safe step: a shadow search pilot on 30–50 real queries with independently
labelled relevant spans, no-answer cases and exact identifiers. Show existing
results normally and record what a model would reorder or reject. Adopt filtering
only after measuring acceptable relevant-result loss on separate validation data.
Do not globally reuse 0.30 across prompts, models, languages or task definitions.

## Reproduction and checks

[filter-results.json](filter-results.json) records aggregate counts, ranking metrics,
per-query losses, hashes, pinned revisions and the resident E5 profile. Original
benchmark artifacts and fixture bytes were not overwritten.

Fresh fixture SHA-256:
`bd2d8cbfe6b75ac007f017bd04dd8dda02d73655d1ebad6ff91259200eda0bcb`.
Prompt SHA-256:
`3618f33c6a7de540eeeb5ae927ee1edd03a37b3aaa759587a51fb0e3886f5998`.

All runs completed. Eleven experiment contract tests and Python byte-compilation
passed. No Rust/Android source was changed or deployed; production gates were not
substituted by this experiment.

Model-interface sources: [Julia pinned card](https://huggingface.co/SupersonicLabs/Julia-1/blob/a85b127321d580d65176c89ced8273f305745d85/README.md),
[Jev introduction](https://docs.typesafe.ai/introduction),
[E5-small card](https://huggingface.co/intfloat/multilingual-e5-small).
