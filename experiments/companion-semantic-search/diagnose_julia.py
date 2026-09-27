"""Post-hoc runtime sanity checks, not prompt tuning or a replacement benchmark."""

import argparse
import itertools
from pathlib import Path

from benchmark import save
from neural import Julia, configure, torch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    configure(4)
    adapter = Julia(args.models / "julia")
    from julia.inference import TransformerEngine
    reference = TransformerEngine(str(args.models / "julia"), device="cpu", max_length=1024, head_length=256, memory_map=True)
    examples = [
        {"name": "official_billing", "state": "I was charged twice for the same order.", "question": "Which team should handle this request?", "options": ["Billing and payment disputes", "Shipping and delivery", "Account access and login"], "expected": 0},
        {"name": "explicit_negation", "state": "The APK was built locally, but it was not published.", "question": "Does the text say that the APK has already been published?", "options": ["Yes, the APK has already been published.", "No, the APK has not been published.", "There is not enough information to decide."], "expected": 1},
        {"name": "unrelated_to_search", "state": "The microphone permission was denied.", "question": "Does the passage satisfy the search request, including its conditions about completion, negation, or evidence? Search request: APK release has been published.", "options": ["The passage satisfies the search request and its conditions.", "The passage does not satisfy the search request or contradicts its conditions.", "The passage lacks enough evidence to decide."], "expected": 1},
    ]
    rows = []
    checks = []
    for example in examples:
        for order in itertools.permutations(range(3)):
            rows.append({"state": example["state"], "question": example["question"], "options": [example["options"][index] for index in order], "type": "choice"})
            checks.append({"example": example["name"], "order": order, "expected_original_index": example["expected"]})
    fast = torch.tensor(adapter.engine.logits(rows), dtype=torch.float64)
    native = torch.tensor(reference.logits(rows), dtype=torch.float64)
    for index, check in enumerate(checks):
        winner = int(fast[index].argmax())
        check["selected_original_index"] = check["order"][winner]
        check["correct"] = check["selected_original_index"] == check["expected_original_index"]
        check["probabilities_in_option_order"] = torch.softmax(fast[index], dim=-1).tolist()
    result = {
        "diagnostic_only": True,
        "fast_vs_reference_max_absolute_logit_difference": float((fast - native).abs().max()),
        "fast_vs_reference_same_predictions": int((fast.argmax(dim=-1) == native.argmax(dim=-1)).sum()),
        "checks": checks,
    }
    save(args.output, result)
    import json
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
