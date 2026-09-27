"""Evaluate three frozen Julia adapters at 0.30 without changing production search."""

import argparse
import hashlib
import json
import math
import struct
import time
from pathlib import Path

from benchmark import rss_mib, save
from corpus import load_corpus
from filter_policy import apply_filter
from filter_prompts import english_noul, original_choice, russian_noul
from metrics import average, ranking_metrics, timings_ms
from neural import Julia, configure, torch

THRESHOLD = 0.30


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def weights_profile(path: Path) -> dict:
    with path.open("rb") as stream:
        header_length = struct.unpack("<Q", stream.read(8))[0]
        header = json.loads(stream.read(header_length))
    return {
        "bytes": path.stat().st_size,
        "mib": path.stat().st_size / 1024**2,
        "floating_point_elements": sum(math.prod(value["shape"]) for key, value in header.items() if key != "__metadata__" and value["dtype"].startswith(("F", "BF"))),
    }


def summarize(corpus, retrieval: dict, predictions: dict) -> dict:
    counts = {key: 0 for key in ("relevant_kept", "relevant_dropped", "irrelevant_kept", "irrelevant_dropped")}
    methods = {name: [] for name in ("unfiltered", "filter_only", "filter_and_rerank")}
    no_answer_nonempty = 0
    lost = []
    cases = []
    for query in corpus.queries:
        candidates = retrieval["queries"][query.id]["rankings"]["hybrid_rrf"]
        prediction = predictions[query.id]
        probabilities = [prediction["scores"][doc_id] for doc_id in candidates]
        outcome = apply_filter(candidates, probabilities, query.relevant, THRESHOLD)
        for key in counts:
            counts[key] += getattr(outcome, key)
        if query.relevant:
            methods["unfiltered"].append(ranking_metrics(candidates, query.relevant))
            methods["filter_only"].append(ranking_metrics(list(outcome.kept_in_original_order), query.relevant))
            methods["filter_and_rerank"].append(ranking_metrics(list(outcome.reranked), query.relevant))
        elif query.kind == "unanswerable" and outcome.kept_in_original_order:
            no_answer_nonempty += 1
        for doc_id in query.relevant:
            if doc_id in candidates and doc_id not in outcome.kept_in_original_order:
                lost.append({"query_id": query.id, "document_id": doc_id, "positive_probability": prediction["scores"][doc_id]})
        cases.append({"query_id": query.id, "candidate_count": len(candidates), "kept_count": len(outcome.kept_in_original_order), "relevant_in_candidates": sum(doc_id in query.relevant for doc_id in candidates), "relevant_kept": outcome.relevant_kept})
    rejected = counts["relevant_dropped"] + counts["irrelevant_dropped"]
    relevant_total = counts["relevant_kept"] + counts["relevant_dropped"]
    irrelevant_total = counts["irrelevant_kept"] + counts["irrelevant_dropped"]
    return {
        "counts": counts,
        "relevant_retention": counts["relevant_kept"] / relevant_total if relevant_total else None,
        "irrelevant_removal": counts["irrelevant_dropped"] / irrelevant_total if irrelevant_total else None,
        "rejection_precision": counts["irrelevant_dropped"] / rejected if rejected else None,
        "ranking_quality": {name: average(values) for name, values in methods.items()},
        "unanswerable_queries": sum(query.kind == "unanswerable" for query in corpus.queries),
        "unanswerable_queries_still_nonempty": no_answer_nonempty,
        "lost_relevant": lost,
        "warm_filter_timing": timings_ms([value["seconds"] for value in predictions.values()]),
        "per_query": cases,
    }


def predict_corpus(engine, corpus, retrieval: dict, build_row, positive_index: int, variant: str) -> dict:
    documents = {document.id: document.text for document in corpus.documents}
    predictions = {}
    for number, query in enumerate(corpus.queries, 1):
        candidates = retrieval["queries"][query.id]["rankings"]["hybrid_rrf"]
        rows = [build_row(query.text, documents[doc_id]) for doc_id in candidates]
        started = time.perf_counter()
        logits = torch.tensor(engine.logits(rows), dtype=torch.float64)
        probabilities = torch.softmax(logits, dim=-1)[:, positive_index].tolist()
        elapsed = time.perf_counter() - started
        if len(probabilities) != len(candidates):
            raise ValueError("Incorrect result count")
        predictions[query.id] = {"scores": dict(zip(candidates, probabilities)), "seconds": elapsed}
        if number % 10 == 0:
            print(json.dumps({"variant": variant, "completed_queries": number}), flush=True)
    return predictions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--original-artifacts", type=Path, required=True)
    parser.add_argument("--fresh-artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    configure(4)
    directory = Path(__file__).parent
    manifest = json.loads((directory / "models.json").read_text())
    result = {
        "threshold": THRESHOLD,
        "models": manifest,
        "prompt_sha256": digest(directory / "filter_prompts.py"),
        "protocol_sha256": digest(directory / "FILTER_PROTOCOL.md"),
        "threads": 4,
        "dtype": "float32",
        "weights": {name: weights_profile(args.models / name / "model.safetensors") for name in ("embedding", "julia")},
        "datasets": {},
    }
    started = time.perf_counter()
    adapter = Julia(args.models / "julia")
    result["julia_model_construction_seconds"] = time.perf_counter() - started
    adapter.engine.logits([english_noul("Find a warmup example.", "This is a warmup example.")])
    for name, filename, artifact_directory in (("fresh_synthetic", "filter_fixture.json", args.fresh_artifacts), ("original_seen", "fixture.json", args.original_artifacts)):
        dataset = directory / filename
        corpus = load_corpus(dataset)
        retrieval = json.loads((artifact_directory / "retrieve.json").read_text())
        if retrieval["metadata"]["dataset_sha256"] != digest(dataset) or retrieval["metadata"]["models"] != manifest:
            raise ValueError("Retrieval provenance mismatch")
        entry = {"dataset_sha256": digest(dataset), "documents": len(corpus.documents), "queries": len(corpus.queries), "answerable_queries": sum(bool(query.relevant) for query in corpus.queries), "variants": {}}
        for variant, build_row, positive_index in (("original_choice", original_choice, 0), ("english_noul", english_noul, 1), ("russian_noul", russian_noul, 1)):
            if name == "original_seen" and variant == "original_choice":
                previous = json.loads((args.original_artifacts / "julia.json").read_text())
                if previous["metadata"] != retrieval["metadata"]:
                    raise ValueError("Original Julia provenance mismatch")
                predictions = {qid: {"scores": {doc_id: score["score"] for doc_id, score in row["scores"].items()}, "seconds": row["rerank_seconds"]} for qid, row in previous["queries"].items()}
            else:
                predictions = predict_corpus(adapter.engine, corpus, retrieval, build_row, positive_index, variant)
            entry["variants"][variant] = summarize(corpus, retrieval, predictions)
            save(args.output.parent / (name + "-" + variant + "-predictions.json"), predictions)
            print(json.dumps({"dataset": name, "variant": variant, "counts": entry["variants"][variant]["counts"]}), flush=True)
        result["datasets"][name] = entry
        save(args.output, result)
    result["peak_rss_mib"] = rss_mib()
    save(args.output, result)
    print(json.dumps({"completed": True, "peak_rss_mib": result["peak_rss_mib"]}), flush=True)


if __name__ == "__main__":
    main()
