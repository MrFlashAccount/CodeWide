"""Download pinned public artifacts. This command never reads chat data."""

import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"

from huggingface_hub import snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name("models.json").read_text())
    for name, spec in manifest.items():
        directory = args.directory / name
        patterns = [
            "config.json", "model.safetensors", "tokenizer*.json",
            "special_tokens_map.json", "sentencepiece.bpe.model",
        ]
        if name == "julia":
            patterns += ["julia/*.py", "julia/router/*.py", "encoder/config.json",
                         "tokenizer/*.json", "julia_config.json", "inference-policy.json"]
        snapshot_download(
            repo_id=spec["repository"], revision=spec["revision"],
            local_dir=directory, allow_patterns=patterns, token=False,
            max_workers=4,
        )
        digest = hashlib.file_digest((directory / "model.safetensors").open("rb"), "sha256").hexdigest()
        print(json.dumps({"model": name, "revision": spec["revision"], "weights_sha256": digest}), flush=True)


if __name__ == "__main__":
    main()
