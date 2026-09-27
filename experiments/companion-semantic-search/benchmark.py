"""Run independent processes for retrieval and each reranker; save private artifacts."""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import resource
import time
from pathlib import Path

from corpus import load_corpus
from retrieval import LexicalIndex, reciprocal_rank_fusion


def save(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("w", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def rss_mib() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def metadata(args) -> dict:
    return {
        "dataset_sha256": hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
        "models": json.loads(Path(__file__).with_name("models.json").read_text()),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "threads": args.threads,
        "dtype": "float32",
        "versions": {name: importlib.metadata.version(name) for name in ("torch", "transformers", "numpy", "safetensors", "huggingface_hub", "sentencepiece", "tokenizers")},
    }


def retrieve(args, corpus) -> None:
    import numpy as np
    from neural import Embeddings, configure
    configure(args.threads)
    result = {"metadata": metadata(args), "import_peak_rss_mib": rss_mib(), "queries": {}}
    started = time.perf_counter()
    lexical = LexicalIndex(corpus.documents)
    result["lexical_index_seconds"] = time.perf_counter() - started
    started = time.perf_counter()
    model = Embeddings(args.models / "embedding")
    result["model_load_seconds"] = time.perf_counter() - started
    model.encode(["A search engine warmup."], "query: ")
    started = time.perf_counter()
    vectors = model.encode([doc.text for doc in corpus.documents], "passage: ")
    result["embedding_index_seconds"] = time.perf_counter() - started
    result["embedding_bytes"] = vectors.nbytes
    for number, query in enumerate(corpus.queries, 1):
        started = time.perf_counter()
        current = lexical.current(query.text)
        current_seconds = time.perf_counter() - started
        started = time.perf_counter()
        bm25 = lexical.bm25(query.text)
        lexical_seconds = time.perf_counter() - started
        started = time.perf_counter()
        vector = model.encode([query.text], "query: ")[0]
        similarities = vectors @ vector
        dense = [corpus.documents[int(index)].id for index in np.argsort(-similarities, kind="stable")[:20]]
        dense_seconds = time.perf_counter() - started
        started = time.perf_counter()
        hybrid = reciprocal_rank_fusion(bm25, dense)
        fusion_seconds = time.perf_counter() - started
        result["queries"][query.id] = {
            "rankings": {"current_fts": current, "lexical_bm25": bm25, "dense_e5": dense, "hybrid_rrf": hybrid},
            "seconds": {"current_fts": current_seconds, "lexical_bm25": lexical_seconds, "dense_e5": dense_seconds, "hybrid_rrf": lexical_seconds + dense_seconds + fusion_seconds},
        }
        if number % 10 == 0:
            print(json.dumps({"stage": "retrieve", "completed_queries": number}), flush=True)
    lexical.close()
    result["max_observed_tokens"] = model.max_observed_tokens
    result["document_count"] = len(corpus.documents)
    result["peak_rss_mib"] = rss_mib()
    save(args.artifacts / "retrieve.json", result)
    print(json.dumps({"stage": "retrieve", "completed": True, "documents": len(corpus.documents), "peak_rss_mib": result["peak_rss_mib"]}), flush=True)


def rerank(args, corpus) -> None:
    from neural import CrossEncoder, Julia, configure
    configure(args.threads)
    result = {"metadata": metadata(args), "import_peak_rss_mib": rss_mib(), "queries": {}}
    retrieval = json.loads((args.artifacts / "retrieve.json").read_text())
    if retrieval["metadata"]["dataset_sha256"] != result["metadata"]["dataset_sha256"]:
        raise ValueError("Dataset changed between retrieval and reranking")
    started = time.perf_counter()
    model = Julia(args.models / "julia") if args.stage == "julia" else CrossEncoder(args.models / "reranker")
    result["model_load_seconds"] = time.perf_counter() - started
    model.score("A search engine warmup.", ["This is a search engine warmup."])
    documents = {doc.id: doc for doc in corpus.documents}
    for number, query in enumerate(corpus.queries, 1):
        candidates = retrieval["queries"][query.id]["rankings"]["hybrid_rrf"]
        passages = [documents[doc_id].text for doc_id in candidates]
        started = time.perf_counter()
        scored = model.score(query.text, passages)
        if len(scored) != len(candidates):
            raise ValueError("Model returned an incorrect candidate count")
        ordered = sorted(range(len(candidates)), key=lambda index: (-scored[index]["score"], index))
        elapsed = time.perf_counter() - started
        result["queries"][query.id] = {
            "ranking": [candidates[index] for index in ordered],
            "scores": {doc_id: score for doc_id, score in zip(candidates, scored)},
            "rerank_seconds": elapsed,
            "pipeline_seconds": retrieval["queries"][query.id]["seconds"]["hybrid_rrf"] + elapsed,
        }
        if number % 10 == 0:
            print(json.dumps({"stage": args.stage, "completed_queries": number}), flush=True)
    result["max_observed_tokens"] = model.max_observed_tokens
    result["peak_rss_mib"] = rss_mib()
    save(args.artifacts / (args.stage + ".json"), result)
    print(json.dumps({"stage": args.stage, "completed": True, "peak_rss_mib": result["peak_rss_mib"]}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("retrieve", "julia", "reranker"), required=True)
    parser.add_argument("--dataset", type=Path, default=Path(__file__).with_name("fixture.json"))
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.threads <= 16:
        raise ValueError("Use 1 to 16 CPU threads")
    corpus = load_corpus(args.dataset)
    if args.stage == "retrieve":
        retrieve(args, corpus)
    else:
        rerank(args, corpus)


if __name__ == "__main__":
    main()
