"""Fast contract tests; model quality is measured, not hardcoded as a test."""

import math
import unittest
from pathlib import Path

from corpus import Document, load_corpus
from metrics import ranking_metrics
from retrieval import LexicalIndex, expression, reciprocal_rank_fusion


class Contracts(unittest.TestCase):
    def test_fixture_is_valid_and_covers_answerability(self):
        corpus = load_corpus(Path(__file__).with_name("fixture.json"))
        self.assertGreaterEqual(len(corpus.queries), 30)
        self.assertEqual({q.lang for q in corpus.queries}, {"ru", "en"})
        self.assertTrue(any(q.kind == "unanswerable" and not q.relevant for q in corpus.queries))

    def test_current_search_requires_every_prefix_and_orders_by_recency(self):
        index = LexicalIndex((Document("old", "network reconnect fixed", 1), Document("new", "network reconnect tested", 3), Document("unrelated", "network permissions", 5)))
        try:
            self.assertEqual(index.current("network recon"), ["new", "old"])
            self.assertEqual(index.current("network missing"), [])
            self.assertEqual(set(index.bm25("network missing")), {"new", "old", "unrelated"})
        finally:
            index.close()

    def test_query_quotes_operators_and_enforces_utf8_limits(self):
        self.assertEqual(expression('foo "bar"', "AND"), '"foo"* AND """bar"""*')
        for query in ("", "я" * 513, " ".join(["x"] * 33)):
            with self.assertRaises(ValueError):
                expression(query, "AND")

    def test_fusion_rewards_shared_candidates_and_does_not_add_new_ones(self):
        result = reciprocal_rank_fusion(["a", "b"], ["c", "b"])
        self.assertEqual(result[0], "b")
        self.assertEqual(set(result), {"a", "b", "c"})
        self.assertEqual(reciprocal_rank_fusion([], ["c", "a"]), ["c", "a"])

    def test_metrics_penalize_missed_and_late_answers(self):
        result = ranking_metrics(["wrong", "correct"], ("correct",))
        self.assertEqual(result["hit_at_1"], 0)
        self.assertEqual(result["hit_at_5"], 1)
        self.assertEqual(result["mrr_at_10"], 0.5)
        self.assertAlmostEqual(result["ndcg_at_5"], 1 / math.log2(3))
        self.assertEqual(ranking_metrics([], ("correct",))["recall_at_20"], 0)
        self.assertEqual(ranking_metrics(["a"], ("a", "b"))["recall_at_20"], 0.5)
        with self.assertRaises(ValueError):
            ranking_metrics(["a"], ())
        with self.assertRaises(ValueError):
            ranking_metrics(["a", "a"], ("a",))


if __name__ == "__main__":
    unittest.main()
