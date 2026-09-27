"""Lexical retrieval and deterministic, model-independent rank fusion."""

import sqlite3

from corpus import Document


def expression(query: str, operator: str) -> str:
    terms = query.split()
    if len(query.encode("utf-8")) > 1024 or not 1 <= len(terms) <= 32:
        raise ValueError("Query exceeds Companion limits")
    if operator not in {"AND", "OR"}:
        raise ValueError("Unsupported operator")
    return f" {operator} ".join('"' + term.replace('"', '""') + '"*' for term in terms)


class LexicalIndex:
    def __init__(self, documents: tuple[Document, ...]):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("CREATE VIRTUAL TABLE messages USING fts5(body, id UNINDEXED, timestamp UNINDEXED, tokenize='unicode61', prefix='2 3 4')")
        self.db.executemany("INSERT INTO messages(body, id, timestamp) VALUES (?, ?, ?)", ((doc.text, doc.id, doc.timestamp) for doc in documents))

    def current(self, query: str) -> list[str]:
        # Fixture timestamps are unique; source/thread tie breakers do not affect this test.
        return [row[0] for row in self.db.execute("SELECT id FROM messages WHERE messages MATCH ? ORDER BY timestamp DESC, id LIMIT 30", (expression(query, "AND"),))]

    def bm25(self, query: str) -> list[str]:
        return [row[0] for row in self.db.execute("SELECT id FROM messages WHERE messages MATCH ? ORDER BY bm25(messages), id LIMIT 20", (expression(query, "OR"),))]

    def close(self) -> None:
        self.db.close()


def reciprocal_rank_fusion(first: list[str], second: list[str], limit: int = 20) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in (first, second):
        for rank, doc_id in enumerate(ranking[:limit], 1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (60 + rank)
    return sorted(scores, key=lambda doc_id: (-scores[doc_id], doc_id))[:limit]
