# Follow-up: a fixed 0.30 Julia relevance filter

This is a new exploratory experiment, prompted by the user's proposal. It does
not overwrite the original benchmark, its prompt, labels or results. No product
behavior, shared adapter or production rejection policy changes.

Before inference, freeze three adapters and one threshold:

1. Original three-option English `choice`, positive option first; reuse the
   original predictions on the original fixture.
2. English `noul`, descriptive negative/positive options in false/true order.
   Put both the search request and passage in the state. Ask a short relevance
   question with explicit status, negation, date and identifier conditions.
3. The equivalent Russian `noul` question and descriptive false/true options.

Keep a candidate when its positive-option softmax probability is at least 0.30.
The numeric score is **not assumed calibrated**. Measure both filter-only
(preserve existing order) and filter-plus-rerank (descending positive probability).
Keep retrieval membership identical across adapters. Never inject a gold result.

Measure retained/dropped relevant and irrelevant candidates; relevant loss is the
primary risk. Also measure top-1/top-5, nDCG@5, candidate recall, rejection precision
and remaining results on no-answer queries. A high rejection precision alone is
insufficient on a corpus where most query/candidate pairs are irrelevant.

Use the original seen fixture for exploratory comparison and a new separately
authored synthetic fixture fixed before this run. The fresh fixture is not an
independent human-labelled or representative benchmark. No prompt iteration,
threshold optimization or selection followed by a fresh claim of held-out quality.

Use the same pinned Julia CPU FP32 runtime, full head, strict 1,024-token budget,
four PyTorch threads and hybrid top-20 candidates as before. Run fully locally;
no private data is needed for this follow-up. Save artifacts outside the repository
and publish synthetic aggregate evidence only.

Decision boundary: a promising synthetic result permits a real-query shadow test,
not automatic hiding of search results. A failed adapter is not a verdict on Jev,
which is not evaluated here. On production exact identifiers and source access
rules must not be overridden by an unvalidated semantic score.
