"""Prueba del flujo de calibración con ajustes manuales.

Genera una hoja sintética con anclas interiores (marco ancla), aplica rotación,
brillo y contraste, verifica que calibrate_sheet detecta 4 anclas y la rejilla,
y comprueba que una plantilla con anclas normalizadas lee correctamente la hoja
ajustada. Las coordenadas de la rejilla son relativas al marco de anclas.

Uso: python scripts/test_calibrate.py
"""

from __future__ import annotations

import json
import sys

import cv2
import numpy as np

sys.path.insert(0, ".")
from python.omr import BubbleRegion, OMRTemplate, calibrate_sheet, preprocess_image, process_image  # noqa: E402

CANVAS_W, CANVAS_H = 1000, 930
FRAME_TL = (30.0, 30.0)
FRAME_BR = (970.0, 900.0)
FRAME_W = FRAME_BR[0] - FRAME_TL[0]
FRAME_H = FRAME_BR[1] - FRAME_TL[1]
GRID_COLS = [0.10, 0.22, 0.335, 0.45, 0.66, 0.77, 0.87, 0.96]
GRID_ROWS = [round(0.05 + index * 0.89 / 24, 4) for index in range(25)]
OPTIONS = ["A", "B", "C", "D"]
BLANK_QUESTIONS = {"7", "50"}


def bubble_center(question: int, option_index: int) -> tuple[float, float]:
    group = (question - 1) // len(GRID_ROWS)
    row_index = (question - 1) % len(GRID_ROWS)
    norm_x = GRID_COLS[group * 4 + option_index]
    norm_y = GRID_ROWS[row_index]
    return FRAME_TL[0] + norm_x * FRAME_W, FRAME_TL[1] + norm_y * FRAME_H


def build_template(source_anchors) -> OMRTemplate:
    # Las burbujas se expresan en coordenadas del marco de anclas (0..1), que es
    # exactamente el lienzo rectificado: ancla sup-izq -> (0,0).
    bubbles = []
    for question in range(1, 51):
        group = (question - 1) // len(GRID_ROWS)
        row_index = (question - 1) % len(GRID_ROWS)
        norm_y = GRID_ROWS[row_index]
        for option_index, option in enumerate(OPTIONS):
            norm_x = GRID_COLS[group * 4 + option_index]
            bubbles.append(BubbleRegion(
                question_id=str(question),
                option_id=option,
                x=max(0.0, norm_x - 0.016),
                y=max(0.0, norm_y - 0.018),
                width=0.032,
                height=0.036,
            ))
    return OMRTemplate(
        canvas_width=CANVAS_W,
        canvas_height=CANVAS_H,
        source_anchors=source_anchors,
        target_anchors=((0, 0), (CANVAS_W, 0), (CANVAS_W, CANVAS_H), (0, CANVAS_H)),
        bubbles=tuple(bubbles),
        algorithm_version="omr-1-test",
    )


def render_sheet(marks: dict[str, str]) -> np.ndarray:
    canvas = np.full((CANVAS_H, CANVAS_W, 3), 255, dtype=np.uint8)
    for cx, cy in (FRAME_TL, (FRAME_BR[0], FRAME_TL[1]), FRAME_BR, (FRAME_TL[0], FRAME_BR[1])):
        cv2.rectangle(canvas, (int(cx) - 9, int(cy) - 9), (int(cx) + 9, int(cy) + 9), (0, 0, 0), -1)
    for question in range(1, 51):
        for option_index, option in enumerate(OPTIONS):
            x, y = bubble_center(question, option_index)
            filled = marks.get(str(question)) == option
            cv2.circle(canvas, (int(round(x)), int(round(y))), 13, (20, 20, 20), -1 if filled else 2)
    return canvas


def main() -> None:
    marks = {str(question): OPTIONS[question % 4] for question in range(1, 51)}
    for question in BLANK_QUESTIONS:
        del marks[question]
    sheet = render_sheet(marks)

    rotation, brightness, contrast = 2.0, 1.15, 1.1
    # La calibración recibe la imagen original y aplica los ajustes una sola vez.
    analysis = calibrate_sheet(
        sheet,
        rotation=rotation,
        brightness=brightness,
        contrast=contrast,
        canvas_width=CANVAS_W,
        canvas_height=CANVAS_H,
        expected_rows=len(GRID_ROWS),
    )
    adjusted = preprocess_image(sheet, rotation=rotation, brightness=brightness, contrast=contrast)
    height, width = adjusted.shape[:2]
    failures = []
    if analysis["detection"] != "ok":
        failures.append(f"detection={analysis['detection']} columns={len(analysis['columns'])} rows={len(analysis['rows'])}")
    if len(analysis["anchors"]) != 4:
        failures.append(f"anchors={len(analysis['anchors'])}")

    if not failures:
        # Ojo: python/omr.py trabaja con anclas en píxeles; la capa API escala las
        # anclas normalizadas (0..1) que se guardan en la plantilla.
        pixel_anchors = tuple((anchor["cx"], anchor["cy"]) for anchor in analysis["anchors"])
        calibrated_template = build_template(pixel_anchors)
        read = process_image(adjusted, calibrated_template, threshold=0.30, margin=0.10)
        for row in read["rows"]:
            question = row["questionId"]
            if question in BLANK_QUESTIONS:
                if row["status"] != "blank":
                    failures.append(f"q{question}: esperaba blank, obtuvo {row['status']}")
            elif row["status"] != "single" or row["selectedOptionIds"] != [marks[question]]:
                failures.append(f"q{question}: {row['status']} {row['selectedOptionIds']} esperaba {marks[question]}")

    summary = {
        "adjustedSize": [int(height), int(width)],
        "anchors": len(analysis["anchors"]),
        "columns": len(analysis["columns"]),
        "rows": len(analysis["rows"]),
        "normalizedAnchors": [[round(a["cx"] / width, 4), round(a["cy"] / height, 4)] for a in analysis["anchors"]],
        "failures": failures,
        "ok": not failures,
    }
    print(json.dumps(summary, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
