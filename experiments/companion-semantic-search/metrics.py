"""Ranking metrics, deliberately separate from unanswerable-query decisions."""

import math
import statistics


def ranking_metrics(ranking: list[str], relevant: tuple[str, ...]) -> dict[str, float]:
    if not relevant:
        raise ValueError("Ranking metrics require answerable labels")
    if len(set(ranking)) != len(ranking):
        raise ValueError("A ranking cannot repeat a document")
    gold = set(relevant)
    matches = [rank for rank, doc_id in enumerate(ranking, 1) if doc_id in gold]
    dcg = sum(1.0 / math.log2(rank + 1) for rank in matches if rank <= 5)
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, min(5, len(gold)) + 1))
    return {
        "hit_at_1": float(any(rank <= 1 for rank in matches)),
        "hit_at_5": float(any(rank <= 5 for rank in matches)),
        "mrr_at_10": 1.0 / matches[0] if matches and matches[0] <= 10 else 0.0,
        "ndcg_at_5": dcg / ideal,
        "recall_at_20": sum(rank <= 20 for rank in matches) / len(gold),
    }


def average(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    return {key: statistics.mean(row[key] for row in rows) for key in rows[0]}


def timings_ms(seconds: list[float]) -> dict[str, float]:
    if not seconds:
        return {}
    ordered = sorted(seconds)
    return {
        "count": len(seconds),
        "median_ms": statistics.median(seconds) * 1000,
        "p95_observed_ms": ordered[max(0, math.ceil(0.95 * len(ordered)) - 1)] * 1000,
        "min_ms": ordered[0] * 1000,
        "max_ms": ordered[-1] * 1000,
    }
