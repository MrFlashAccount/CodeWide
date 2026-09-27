"""Frozen follow-up request templates; no model-output-dependent prompt changes."""


def original_choice(query: str, passage: str) -> dict:
    return {
        "state": passage,
        "question": "Does the passage satisfy the search request, including its conditions about completion, negation, or evidence? Search request: " + query,
        "options": [
            "The passage satisfies the search request and its conditions.",
            "The passage does not satisfy the search request or contradicts its conditions.",
            "The passage lacks enough evidence to decide.",
        ],
        "type": "choice",
    }


def english_noul(query: str, passage: str) -> dict:
    return {
        "state": "Search request:\n" + query + "\n\nPassage:\n" + passage,
        "question": "Does the passage answer the search request? A shared topic alone is not enough. Respect requested status, negation, dates, and exact identifiers.",
        "options": [
            "The passage does not answer the search request.",
            "The passage answers the search request.",
        ],
        "type": "noul",
    }


def russian_noul(query: str, passage: str) -> dict:
    return {
        "state": "Запрос пользователя:\n" + query + "\n\nФрагмент:\n" + passage,
        "question": "Отвечает ли фрагмент на запрос пользователя? Совпадения темы недостаточно. Учитывай отрицания, статус действия, даты и точные идентификаторы.",
        "options": [
            "Фрагмент не отвечает на запрос пользователя.",
            "Фрагмент отвечает на запрос пользователя.",
        ],
        "type": "noul",
    }
