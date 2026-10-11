# Companion semantic-search experiment

This is an isolated CPU experiment, not a Companion feature or a service change.
It compares the current message-search semantics, a stronger lexical baseline,
multilingual embeddings, and two alternative rerankers. No chat content is sent
to an inference provider. Downloading model artifacts is a separate operation;
evaluation uses local files with Hugging Face offline mode enabled.

## Predeclared comparison

- `current_fts`: SQLite FTS5 `unicode61`, prefix tokens joined with AND, newest first,
  matching `crates/agent-provider-codex/src/message_search/query.rs`.
- `lexical_bm25`: the same tokens joined with OR and ranked by SQLite BM25.
- `dense_e5`: normalized mean-pooled multilingual E5-small embeddings with the
  required `query: ` and `passage: ` prefixes.
- `hybrid_rrf`: equal-weight reciprocal-rank fusion (constant 60) of the top 20
  lexical and dense results.
- `hybrid_julia`: rerank the hybrid top 20 with a fixed generic relevance question
  plus the original user query. Options: match, not a match, insufficient evidence.
- `hybrid_crossencoder`: rerank the identical candidates with the dedicated
  multilingual mMARCO MiniLM cross-encoder.

No query-specific prompt engineering, gold-target injection, fitted thresholds,
or selection of the best result after trying different model prompts is allowed.
Model revisions are pinned in `models.json`. Julia uses CPU FP32, strict encoding,
1,024 combined tokens and its full decision head. E5 and the cross-encoder use a
512-token budget. Encoding overflow must be visible, not silently truncate fixtures.

## Evidence boundaries

The checked-in fixture is hand-authored and labelled before model evaluation.
Its results are a controlled feasibility test, not accuracy on Sergey's searches.
It includes Russian and English paraphrases, exact identifiers, close topical
negatives, negation, proposed versus completed work, and no-answer requests.

A separately exported, bounded sample of this project's live Companion index is
for realistic indexing/search timing and qualitative inspection only. It is not
labelled exhaustively, so it must not be assigned recall or accuracy. Raw source
text, raw search results, and source identifiers remain in a private task folder,
outside the repository. The source SQLite database is opened read-only, and the
experiment's own chat is excluded from the sample.

Record per-query rankings and nDCG@5, MRR@10, Hit@1/5 and Recall@20. Report
answerable and no-answer cases separately. Reranker quality is bounded by candidate
recall. Report load time, warm query time, indexing time and process peak RSS
separately; this is a shared Linux VM CPU test, not Android, Mac or production SLO proof.

## Decision criteria

Prefer the simplest method that materially improves retrieval over lexical search.
Julia is justified only if it improves the semantic-condition cases over embeddings
and the dedicated reranker at acceptable measured latency. A positive miniature
benchmark authorizes a larger evaluation, not silently replacing production search.

## Setup

Use a disposable Python 3.12 virtual environment outside the repository. Install
CPU PyTorch 2.14.0 from `https://download.pytorch.org/whl/cpu`, Transformers 5.0.0,
NumPy, Safetensors, Hugging Face Hub and SentencePiece. The completed experiment's
report records the exact resolved versions.

From this experiment directory, with the disposable environment activated:

```sh
python -m pip install 'torch==2.14.0' --index-url https://download.pytorch.org/whl/cpu
python -m pip install 'transformers==5.0.0' 'numpy==2.2.6' 'safetensors==0.6.2' 'huggingface_hub==1.33.0' 'sentencepiece==0.2.1' 'tokenizers==0.22.2'
python download_models.py --directory /path/to/private-task/models
python -m unittest discover -s . -p 'test_*.py'
python -m compileall -q .
for search_stage in retrieve julia reranker; do
  python benchmark.py --stage "$search_stage" --models /path/to/private-task/models --artifacts /path/to/private-task/synthetic || break
done
python report.py --artifacts /path/to/private-task/synthetic
python diagnose_julia.py --models /path/to/private-task/models --output /path/to/private-task/julia-diagnostic.json
```

`fixture.json` is deliberately preserved byte-for-byte as the pre-inference
labelled input. Do not tune labels or prompts to improve its measured results.
Add a separately identified dataset for subsequent experiments.

Optional local-history timing (all source data stays outside the repository):

```sh
python export_sample.py --database /absolute/path/to/message-search.sqlite --project /absolute/project/path --exclude-thread CURRENT_THREAD_ID --models /path/to/private-task/models --output /path/to/private-task/real-corpus.json
for search_stage in retrieve julia reranker; do
  python benchmark.py --stage "$search_stage" --dataset /path/to/private-task/real-corpus.json --models /path/to/private-task/models --artifacts /path/to/private-task/real || break
done
python report.py --dataset /path/to/private-task/real-corpus.json --artifacts /path/to/private-task/real
```

Do not commit the private corpus, raw stage artifacts, or source identifiers.
`report.py` prints aggregate metrics only; it deliberately gives no quality
metrics to unlabelled real queries. The separate post-hoc Julia diagnosis does
not select a replacement prompt or overwrite the predeclared benchmark.

The completed run and decision boundaries are in [REPORT.md](REPORT.md).

## Follow-up: fixed 30% filter and E5 footprint

This is a separate exploratory run, with a new synthetic fixture and three
predeclared adapters. It does not overwrite or tune the initial benchmark.
See [FILTER_PROTOCOL.md](FILTER_PROTOCOL.md) and [FILTER_REPORT.md](FILTER_REPORT.md).

```sh
python benchmark.py --stage retrieve --dataset filter_fixture.json --models /path/to/private-task/models --artifacts /path/to/private-task/filter-fresh
python filter_probe.py --models /path/to/private-task/models --original-artifacts /path/to/private-task/synthetic --fresh-artifacts /path/to/private-task/filter-fresh --output /path/to/private-task/filter-followup/summary.json
python profile_e5.py --models /path/to/private-task/models --output /path/to/private-task/filter-followup/e5-profile.json
python -m unittest discover -s . -p 'test_*.py'
python -m compileall -q .
```

The profile requires Linux `/proc/self/statm`. Both experiments are CPU-only;
quantization, Rust integration and production search changes are not included.

Model sources: [E5](https://huggingface.co/intfloat/multilingual-e5-small),
[Julia](https://huggingface.co/SupersonicLabs/Julia-1),
[mMARCO reranker](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1).
