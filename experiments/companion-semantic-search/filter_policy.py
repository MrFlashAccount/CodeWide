"""The experiment-only rejection boundary and its directly observable effects."""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class FilterResult:
    kept_in_original_order: tuple[str, ...]
    reranked: tuple[str, ...]
    relevant_kept: int
    relevant_dropped: int
    irrelevant_kept: int
    irrelevant_dropped: int


def apply_filter(candidates: list[str], probabilities: list[float], relevant: tuple[str, ...], threshold: float) -> FilterResult:
    if len(candidates) != len(probabilities) or len(set(candidates)) != len(candidates):
        raise ValueError("Candidate/probability alignment is invalid")
    if not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("Invalid threshold")
    if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities):
        raise ValueError("Invalid model probability")
    retained = [index for index, value in enumerate(probabilities) if value >= threshold]
    kept = tuple(candidates[index] for index in retained)
    ranked = tuple(candidates[index] for index in sorted(retained, key=lambda index: (-probabilities[index], index)))
    gold = set(relevant)
    relevant_kept = sum(doc_id in gold for doc_id in kept)
    relevant_total = sum(doc_id in gold for doc_id in candidates)
    irrelevant_kept = len(kept) - relevant_kept
    irrelevant_total = len(candidates) - relevant_total
    return FilterResult(kept, ranked, relevant_kept, relevant_total - relevant_kept, irrelevant_kept, irrelevant_total - irrelevant_kept)
