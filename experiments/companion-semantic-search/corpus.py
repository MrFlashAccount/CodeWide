"""Validated, immutable input boundary for the standalone experiment."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Document:
    id: str
    text: str
    timestamp: int


@dataclass(frozen=True)
class Query:
    id: str
    text: str
    kind: str
    lang: str
    relevant: tuple[str, ...]


@dataclass(frozen=True)
class Corpus:
    documents: tuple[Document, ...]
    queries: tuple[Query, ...]


def required_text(row: dict, key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Expected nonempty text field: {key}")
    return value


def load_corpus(path: Path) -> Corpus:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError("Expected an object")
    for key in ("documents", "queries"):
        if not isinstance(raw.get(key), list) or not raw[key]:
            raise ValueError(f"Expected nonempty list: {key}")
        if any(not isinstance(row, dict) for row in raw[key]):
            raise ValueError(f"Expected object rows: {key}")
    documents = []
    for row in raw["documents"]:
        if type(row.get("timestamp")) is not int:
            raise ValueError("Expected integer timestamp")
        documents.append(Document(required_text(row, "id"), required_text(row, "text"), row["timestamp"]))
    ids = {doc.id for doc in documents}
    if len(ids) != len(documents):
        raise ValueError("Duplicate document IDs")
    queries = []
    for row in raw["queries"]:
        relevant = row.get("relevant")
        if not isinstance(relevant, list) or any(not isinstance(item, str) or item not in ids for item in relevant):
            raise ValueError("Unknown relevance IDs")
        kind = required_text(row, "kind")
        if kind not in {"predicate", "semantic", "exact", "unanswerable", "unlabelled"}:
            raise ValueError("Unknown query kind")
        if len(set(relevant)) != len(relevant):
            raise ValueError("Duplicate relevance IDs")
        if bool(relevant) == (kind in {"unanswerable", "unlabelled"}):
            raise ValueError("Query kind and labels disagree")
        queries.append(Query(required_text(row, "id"), required_text(row, "text"), kind, required_text(row, "lang"), tuple(relevant)))
    if len({query.id for query in queries}) != len(queries):
        raise ValueError("Duplicate query IDs")
    return Corpus(tuple(documents), tuple(queries))
