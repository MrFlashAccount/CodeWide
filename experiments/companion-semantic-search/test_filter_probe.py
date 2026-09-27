"""Tests of the proposed threshold boundary, not assertions that a model is right."""

import unittest
from pathlib import Path

from corpus import load_corpus
from filter_policy import apply_filter
from filter_prompts import english_noul, original_choice, russian_noul


class FilterContracts(unittest.TestCase):
    def test_threshold_preserves_equality_and_filters_below(self):
        result = apply_filter(["low", "edge", "high"], [0.299, 0.30, 0.9], ("low", "high"), 0.30)
        self.assertEqual(result.kept_in_original_order, ("edge", "high"))
        self.assertEqual(result.reranked, ("high", "edge"))
        self.assertEqual((result.relevant_kept, result.relevant_dropped), (1, 1))
        self.assertEqual((result.irrelevant_kept, result.irrelevant_dropped), (1, 0))

    def test_filter_does_not_blame_missing_retrieval_target_on_model(self):
        result = apply_filter(["other"], [0.7], ("not_retrieved",), 0.30)
        self.assertEqual(result.relevant_dropped, 0)
        self.assertEqual(result.irrelevant_kept, 1)

    def test_zero_and_one_thresholds_have_consistent_boundaries(self):
        self.assertEqual(apply_filter(["a", "b"], [0.0, 1.0], (), 0.0).kept_in_original_order, ("a", "b"))
        self.assertEqual(apply_filter(["a", "b"], [0.0, 1.0], (), 1.0).kept_in_original_order, ("b",))

    def test_invalid_scores_and_alignment_are_rejected(self):
        for value in (float("nan"), float("inf"), -0.1, 1.1, True):
            with self.assertRaises(ValueError):
                apply_filter(["a"], [value], (), 0.3)
        with self.assertRaises(ValueError):
            apply_filter(["a", "a"], [0.1, 0.5], (), 0.3)
        with self.assertRaises(ValueError):
            apply_filter(["a"], [], (), 0.3)

    def test_fresh_fixture_is_separate_and_valid(self):
        directory = Path(__file__).parent
        fresh = load_corpus(directory / "filter_fixture.json")
        original = load_corpus(directory / "fixture.json")
        self.assertFalse({q.id for q in fresh.queries} & {q.id for q in original.queries})
        self.assertTrue(any(query.kind == "unanswerable" for query in fresh.queries))

    def test_prompts_keep_query_and_passage_and_boolean_order(self):
        for build in (english_noul, russian_noul):
            row = build("REQUEST_MARKER", "PASSAGE_MARKER")
            self.assertIn("REQUEST_MARKER", row["state"])
            self.assertIn("PASSAGE_MARKER", row["state"])
            self.assertEqual(row["type"], "noul")
            self.assertEqual(len(row["options"]), 2)
        self.assertEqual(english_noul("x", "y")["options"][0], "The passage does not answer the search request.")
        self.assertEqual(russian_noul("x", "y")["options"][0], "Фрагмент не отвечает на запрос пользователя.")
        original = original_choice("REQUEST_MARKER", "PASSAGE_MARKER")
        self.assertEqual(original["state"], "PASSAGE_MARKER")
        self.assertIn("REQUEST_MARKER", original["question"])


if __name__ == "__main__":
    unittest.main()
