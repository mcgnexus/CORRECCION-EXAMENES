"""Prueba de ida y vuelta de una plantilla OMR.

Genera una hoja sintética a partir de la plantilla JSON (anclas, burbujas y
marcas), ejecuta process_image y verifica que las respuestas leídas coinciden.

Uso: python scripts/test_template_roundtrip.py <plantilla.json>
"""

from __future__ import annotations

import json
import sys

import cv2
import numpy as np

sys.path.insert(0, ".")
from python.omr import BubbleRegion, OMRTemplate, process_image  # noqa: E402


def load_template(path: str) -> tuple[OMRTemplate, dict]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    template = OMRTemplate(
        canvas_width=data["canvasWidth"],
        canvas_height=data["canvasHeight"],
        source_anchors=tuple(tuple(point) for point in data["sourceAnchors"]),
        target_anchors=tuple(tuple(point) for point in data["targetAnchors"]),
        bubbles=tuple(BubbleRegion(question_id=b["questionId"], option_id=b["optionId"], x=b["x"], y=b["y"], width=b["width"], height=b["height"]) for b in data["bubbles"]),
        algorithm_version=data.get("algorithmVersion", "omr-1"),
    )
    return template, data


def render_sheet(template: OMRTemplate, marks: dict[str, str]) -> bytes:
    canvas = np.full((template.canvas_height, template.canvas_width, 3), 255, dtype=np.uint8)
    anchor_size = 18
    # La hoja sintética se dibuja en espacio canónico: las anclas ocupan las
    # esquinas del lienzo objetivo.
    for x, y in template.target_anchors:
        cx, cy = int(round(x)), int(round(y))
        offset = anchor_size // 2
        cx = min(max(cx, offset), template.canvas_width - offset)
        cy = min(max(cy, offset), template.canvas_height - offset)
        cv2.rectangle(canvas, (cx - offset, cy - offset), (cx + offset, cy + offset), (0, 0, 0), -1)
    for bubble in template.bubbles:
        cx = int(round((bubble.x + bubble.width / 2) * template.canvas_width))
        cy = int(round((bubble.y + bubble.height / 2) * template.canvas_height))
        radius = int(round(min(bubble.width * template.canvas_width, bubble.height * template.canvas_height) / 2.2))
        thickness = 2 if marks.get(bubble.question_id) != bubble.option_id else -1
        cv2.circle(canvas, (cx, cy), radius, (20, 20, 20), thickness)
    ok, encoded = cv2.imencode(".png", canvas)
    if not ok:
        raise SystemExit("No se pudo codificar la hoja sintética")
    return encoded.tobytes()


def main() -> None:
    template_path = sys.argv[1] if len(sys.argv) > 1 else r"fixtures\omr-template-uax-answer-sheet.json"
    template, data = load_template(template_path)

    question_ids = sorted({bubble.question_id for bubble in template.bubbles}, key=lambda value: int(value))
    option_ids = sorted({bubble.option_id for bubble in template.bubbles})
    expected = {question_id: option_ids[index % len(option_ids)] for index, question_id in enumerate(question_ids)}
    marks = expected
    # Dejar en blanco algunas filas para verificar el estado blank
    blank_rows = {question_ids[len(question_ids) // 2], question_ids[-1]}
    for question_id in blank_rows:
        del marks[question_id]

    image = render_sheet(template, marks)
    canonical_template = OMRTemplate(
        canvas_width=template.canvas_width,
        canvas_height=template.canvas_height,
        source_anchors=template.target_anchors,
        target_anchors=template.target_anchors,
        bubbles=template.bubbles,
        algorithm_version=template.algorithm_version,
    )
    result = process_image(image, canonical_template, threshold=data.get("threshold", 0.35), margin=data.get("margin", 0.08))

    failures = []
    blanks = []
    for row in result["rows"]:
        question_id = row["questionId"]
        if question_id in blank_rows:
            if row["status"] != "blank":
                failures.append(f"{question_id}: esperaba blank, obtuvo {row['status']} {row['candidateOptionIds']}")
            else:
                blanks.append(question_id)
            continue
        if row["status"] != "single":
            failures.append(f"{question_id}: esperaba single, obtuvo {row['status']}")
        elif row["selectedOptionIds"] != [marks[question_id]]:
            failures.append(f"{question_id}: esperaba {marks[question_id]}, obtuvo {row['selectedOptionIds']}")

    summary = {
        "template": template_path,
        "questions": len(question_ids),
        "blanks": blanks,
        "failures": failures,
        "ok": not failures,
    }
    print(json.dumps(summary, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
