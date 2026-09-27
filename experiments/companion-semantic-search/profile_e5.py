"""Linux process memory for a resident E5 model and short queries, not UI latency."""

import argparse
import json
import os
import time
from pathlib import Path

from benchmark import rss_mib, save
from corpus import load_corpus
from metrics import timings_ms
from neural import Embeddings, configure


def current_rss_mib() -> float:
    pages = int(Path("/proc/self/statm").read_text().split()[1])
    return pages * os.sysconf("SC_PAGE_SIZE") / 1024**2


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    configure(4)
    result = {"threads": 4, "dtype": "float32", "rss_after_imports_mib": current_rss_mib()}
    started = time.perf_counter()
    model = Embeddings(args.models / "embedding")
    result["construction_seconds"] = time.perf_counter() - started
    result["rss_after_construction_mib"] = current_rss_mib()
    model.encode(["Search engine warmup."], "query: ")
    result["rss_after_warmup_mib"] = current_rss_mib()
    fixture = load_corpus(Path(__file__).with_name("filter_fixture.json"))
    durations = []
    for query in fixture.queries:
        started = time.perf_counter()
        model.encode([query.text], "query: ")
        durations.append(time.perf_counter() - started)
    result["query_encoding_timing"] = timings_ms(durations)
    result["rss_after_queries_mib"] = current_rss_mib()
    result["peak_rss_mib"] = rss_mib()
    result["query_count"] = len(durations)
    result["embedding_dimensions"] = model.model.config.hidden_size
    result["one_fp32_vector_bytes"] = model.model.config.hidden_size * 4
    save(args.output, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
