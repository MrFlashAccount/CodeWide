"""Offline CPU model adapters. No corpus text is sent to a remote service."""

import os
import sys
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import numpy as np
import torch
from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer
from transformers.utils import logging as transformer_logging

transformer_logging.disable_progress_bar()


def configure(threads: int) -> None:
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(42)
    os.environ["JULIA_CPU_THREADS"] = str(threads)


def assert_budget(encoded, maximum: int) -> int:
    lengths = encoded["attention_mask"].sum(dim=1)
    longest = int(lengths.max())
    if longest > maximum:
        raise ValueError(f"Lossless input budget exceeded: {longest} > {maximum}")
    return longest


class Embeddings:
    def __init__(self, directory: Path):
        self.tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
        self.model = AutoModel.from_pretrained(directory, local_files_only=True, trust_remote_code=False, dtype=torch.float32, attn_implementation="sdpa").eval()
        self.max_observed_tokens = 0

    @torch.inference_mode()
    def encode(self, texts: list[str], prefix: str) -> np.ndarray:
        output = []
        for offset in range(0, len(texts), 16):
            batch = self.tokenizer([prefix + text for text in texts[offset:offset + 16]], padding=True, truncation=False, return_tensors="pt")
            self.max_observed_tokens = max(self.max_observed_tokens, assert_budget(batch, 512))
            hidden = self.model(**batch).last_hidden_state
            masked = hidden.masked_fill(~batch["attention_mask"][..., None].bool(), 0.0)
            pooled = masked.sum(dim=1) / batch["attention_mask"].sum(dim=1)[..., None]
            output.append(torch.nn.functional.normalize(pooled, p=2, dim=1).cpu().numpy())
        return np.concatenate(output, axis=0)


class CrossEncoder:
    def __init__(self, directory: Path):
        self.tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(directory, local_files_only=True, trust_remote_code=False, dtype=torch.float32, attn_implementation="sdpa").eval()
        self.max_observed_tokens = 0

    @torch.inference_mode()
    def score(self, query: str, passages: list[str]) -> list[dict]:
        result = []
        for offset in range(0, len(passages), 16):
            texts = passages[offset:offset + 16]
            batch = self.tokenizer([query] * len(texts), texts, padding=True, truncation=False, return_tensors="pt")
            self.max_observed_tokens = max(self.max_observed_tokens, assert_budget(batch, 512))
            scores = self.model(**batch).logits.flatten().cpu().tolist()
            if not all(np.isfinite(score) for score in scores):
                raise ValueError("Nonfinite cross-encoder scores")
            result.extend({"score": score, "decision": "uncalibrated", "probabilities": []} for score in scores)
        return result


class Julia:
    def __init__(self, directory: Path):
        # Pinned, inspected project code; no dynamic Hub code loading or remote inference.
        sys.path.insert(0, str(directory))
        from julia.router.engine import FastEngine
        self.engine = FastEngine(str(directory), device="cpu", max_length=1024, head_length=256, batch_size=16, strict_encoding=True, marker_only_head=False)
        self.max_observed_tokens = 0

    def score(self, query: str, passages: list[str]) -> list[dict]:
        question = "Does the passage satisfy the search request, including its conditions about completion, negation, or evidence? Search request: " + query
        rows = [{
            "state": passage,
            "question": question,
            "options": [
                "The passage satisfies the search request and its conditions.",
                "The passage does not satisfy the search request or contradicts its conditions.",
                "The passage lacks enough evidence to decide.",
            ],
            "type": "choice",
        } for passage in passages]
        for info in self.engine.encoding_info(rows):
            self.max_observed_tokens = max(self.max_observed_tokens, info["tokens"])
        logits = torch.tensor(self.engine.logits(rows), dtype=torch.float64)
        probabilities = torch.softmax(logits, dim=-1).tolist()
        decisions = ("match", "not_match", "insufficient")
        return [{"score": values[0], "decision": decisions[max(range(3), key=values.__getitem__)], "probabilities": values} for values in probabilities]
