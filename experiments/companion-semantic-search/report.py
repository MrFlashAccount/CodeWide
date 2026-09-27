"""Emit metrics only; never emit corpus text or private source identifiers."""

import argparse
import json
from pathlib import Path

from benchmark import save
from corpus import load_corpus
from metrics import average, ranking_metrics, timings_ms


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path(__file__).with_name("fixture.json"))
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    corpus = load_corpus(args.dataset)
    retrieval = json.loads((args.artifacts / "retrieve.json").read_text())
    rerankers = {name: json.loads((args.artifacts / (name + ".json")).read_text()) for name in ("julia", "reranker")}
    for result in rerankers.values():
        if result["metadata"] != retrieval["metadata"]:
            raise ValueError("Mismatched model, runtime or dataset identity")
    methods = ("current_fts", "lexical_bm25", "dense_e5", "hybrid_rrf", "hybrid_julia", "hybrid_crossencoder")
    rankings = {method: {} for method in methods}
    seconds = {method: [] for method in methods}
    for query in corpus.queries:
        item = retrieval["queries"][query.id]
        for method, ranking in item["rankings"].items():
            rankings[method][query.id] = ranking
            seconds[method].append(item["seconds"][method])
        for stage, method in (("julia", "hybrid_julia"), ("reranker", "hybrid_crossencoder")):
            reranked = rerankers[stage]["queries"][query.id]
            if set(reranked["ranking"]) != set(item["rankings"]["hybrid_rrf"]):
                raise ValueError("Reranker changed candidate membership")
            rankings[method][query.id] = reranked["ranking"]
            seconds[method].append(reranked["pipeline_seconds"])
    answerable = [query for query in corpus.queries if query.relevant]
    result = {"metadata": retrieval["metadata"], "counts": {"documents": len(corpus.documents), "queries": len(corpus.queries), "answerable": len(answerable)}, "methods": {}}
    for method in methods:
        result["methods"][method] = {
            "all_answerable": average([ranking_metrics(rankings[method][q.id], q.relevant) for q in answerable]),
            "by_kind": {kind: average([ranking_metrics(rankings[method][q.id], q.relevant) for q in answerable if q.kind == kind]) for kind in ("semantic", "predicate", "exact")},
            "by_language": {lang: average([ranking_metrics(rankings[method][q.id], q.relevant) for q in answerable if q.lang == lang]) for lang in ("ru", "en")},
            "warm_pipeline_timing": timings_ms(seconds[method]),
        }
    # This is an observed argmax diagnostic, NOT a calibrated production acceptance policy.
    julia_results = rerankers["julia"]["queries"]
    no_answer = [q for q in corpus.queries if q.kind == "unanswerable"]
    result["julia_argmax_diagnostic"] = {
        "unanswerable_queries": len(no_answer),
        "unanswerable_with_any_match": sum(any(value["decision"] == "match" for value in julia_results[q.id]["scores"].values()) for q in no_answer),
        "answerable_with_any_match": sum(any(value["decision"] == "match" for value in julia_results[q.id]["scores"].values()) for q in answerable),
        "answerable_with_correct_match": sum(any(doc_id in q.relevant and value["decision"] == "match" for doc_id, value in julia_results[q.id]["scores"].items()) for q in answerable),
    }
    result["resources"] = {
        "retrieval": {key: retrieval[key] for key in ("import_peak_rss_mib", "model_load_seconds", "lexical_index_seconds", "embedding_index_seconds", "embedding_bytes", "max_observed_tokens", "peak_rss_mib")},
        **{name: {key: value[key] for key in ("import_peak_rss_mib", "model_load_seconds", "max_observed_tokens", "peak_rss_mib")} for name, value in rerankers.items()},
    }
    save(args.artifacts / "summary.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
