"""Read-only, bounded local sampling. Never prints or publishes chat contents."""

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from transformers import AutoTokenizer

from benchmark import save


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--exclude-thread", required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Private samples must remain outside the repository")
    tokenizer = AutoTokenizer.from_pretrained(args.models / "embedding", local_files_only=True, trust_remote_code=False)
    database = sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)
    database.execute("PRAGMA query_only = ON")
    documents = []
    source_ids = set()
    threads = set()
    # Short assistant messages, stratified by thread. Not a representative random sample.
    statement = """
      WITH selected AS (
        SELECT m.id, m.body, m.timestamp, m.thread_id,
          row_number() OVER (PARTITION BY m.thread_id ORDER BY m.timestamp DESC, m.id DESC) AS in_thread
        FROM messages_content m JOIN sources s ON s.thread_id = m.thread_id
        WHERE s.cwd = ? AND m.thread_id != ? AND m.kind = 'agent_message'
          AND length(m.body) BETWEEN 80 AND 3500
      )
      SELECT id, body, timestamp, thread_id FROM selected WHERE in_thread <= 4
      ORDER BY in_thread, timestamp DESC, id DESC LIMIT 400
    """
    try:
        for source_id, body, timestamp, thread_id in database.execute(statement, (args.project, args.exclude_thread)):
            offsets = tokenizer(body, add_special_tokens=False, return_offsets_mapping=True, truncation=False)["offset_mapping"]
            stamp = int(datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp())
            for chunk, position in enumerate(range(0, len(offsets), 200)):
                start = offsets[position][0]
                end = offsets[min(position + 199, len(offsets) - 1)][1]
                text = body[start:end]
                if not text.strip():
                    continue
                identity = hashlib.sha256(f"{source_id}:{chunk}".encode()).hexdigest()[:20]
                documents.append({"id": identity, "text": text, "timestamp": stamp})
            source_ids.add(source_id)
            threads.add(thread_id)
    finally:
        database.close()
    query_texts = [
        "Где решили сохранить Markdown вместо обычного текста?",
        "Сократили задержку открытия чата на телефоне",
        "Подтверждённая публикация APK с проверкой скачанного файла",
        "Голосовой ввод переживает переход между экранами",
        "Полный патч вместо обрезанного diff",
        "Закреплённые проекты не пропадают после обновления",
        "Вопрос агента уже есть, но карточка ждёт summary",
        "Сообщение повторно отправляется после разрыва соединения",
        "GPU changes did not improve measured frame rate",
        "Restore the draft before the user starts typing",
        "parsePatchContent",
        "model/list",
    ]
    queries = [{"id": f"real-{index:02}", "text": text, "kind": "unlabelled", "lang": "ru" if index < 9 else "en", "relevant": []} for index, text in enumerate(query_texts, 1)]
    counts = {"source_messages": len(source_ids), "threads": len(threads), "chunks": len(documents), "queries": len(queries), "chunk_tokens": 200, "labelled": False}
    save(args.output, {"description": "Private local sample, not exhaustively labelled; timing only", "sampling": counts, "documents": documents, "queries": queries})
    print(json.dumps(counts), flush=True)


if __name__ == "__main__":
    main()
