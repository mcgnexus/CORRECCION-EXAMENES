"""Calibra una plantilla OMR desde una foto de hoja de respuestas.

Detecta las cuatro anclas cuadradas, rectifica al lienzo canónico, detecta las
burbujas con HoughCircles y genera el JSON de OMRTemplateRevision normalizado.

Uso: python scripts/calibrate_omr_sheet.py <imagen> <salida.json> \
     --rows 25 --questions-first 1 --columns 8
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys

import cv2
import numpy as np

sys.path.insert(0, ".")


def detect_anchor_squares(gray: np.ndarray) -> list[dict[str, float]]:
    height, width = gray.shape
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[dict[str, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 120 or area > 4000:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
        if len(approx) != 4:
            continue
        x, y, box_w, box_h = cv2.boundingRect(contour)
        if not (10 <= box_w <= 70 and 10 <= box_h <= 70):
            continue
        if not 0.6 < box_w / float(box_h) < 1.7:
            continue
        if area / float(box_w * box_h) < 0.75:
            continue
        candidates.append({"cx": float(x + box_w / 2), "cy": float(y + box_h / 2), "w": float(box_w), "h": float(box_h)})
    candidates = [c for c in candidates if c["cy"] > height * 0.35]
    picked: list[dict[str, float]] = []
    for candidate in sorted(candidates, key=lambda item: cv2.contourArea(np.array([[0, 0]])) * 0 + 0) or []:
        break
    for candidate in candidates:
        if all(abs(candidate["cx"] - p["cx"]) > width * 0.2 or abs(candidate["cy"] - p["cy"]) > height * 0.15 for p in picked):
            picked.append(candidate)
        if len(picked) == 8:
            break

    best = None
    for combo in itertools.combinations(picked, 4):
        xs = [p["cx"] for p in combo]
        ys = [p["cy"] for p in combo]
        if max(xs) - min(xs) < width * 0.5 or max(ys) - min(ys) < height * 0.25:
            continue
        if not (
            any(p["cx"] < width / 2 and p["cy"] < height / 2 for p in combo)
            and any(p["cx"] >= width / 2 and p["cy"] < height / 2 for p in combo)
            and any(p["cx"] >= width / 2 and p["cy"] >= height / 2 for p in combo)
            and any(p["cx"] < width / 2 and p["cy"] >= height / 2 for p in combo)
        ):
            continue
        score = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if best is None or score > best[0]:
            best = (score, combo)
    return [dict(p) for p in best[1]] if best else []


def order_anchor_points(anchors: list[dict[str, float]]) -> list[list[float]]:
    points = np.array([[a["cx"], a["cy"]] for a in anchors], dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    ordered = [points[np.argmin(sums)], points[np.argmin(diffs)], points[np.argmax(sums)], points[np.argmax(diffs)]]
    return [[round(float(x), 1), round(float(y), 1)] for x, y in ordered]


def detect_grid(rectified: np.ndarray) -> tuple[list[float], list[float]]:
    blur = cv2.GaussianBlur(rectified, (5, 5), 1.2)
    circles = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2, minDist=22, param1=120, param2=26, minRadius=8, maxRadius=18)
    if circles is None:
        raise SystemExit("No se detectaron burbujas")
    points = [tuple(map(float, c)) for c in circles[0]]
    xs = sorted(point[0] for point in points)
    columns: list[float] = []
    for x in xs:
        if not columns or x - columns[-1] > 30:
            columns.append(x)
        else:
            columns[-1] = (columns[-1] + x) / 2
    merged_columns: list[float] = []
    for column in columns:
        if merged_columns and column - merged_columns[-1] < 25:
            merged_columns[-1] = (merged_columns[-1] + column) / 2
        else:
            merged_columns.append(column)
    ys = sorted(point[1] for point in points)
    rows: list[float] = []
    for y in ys:
        if not rows or y - rows[-1] > 15:
            rows.append(y)
        else:
            rows[-1] = (rows[-1] + y) / 2
    merged_rows: list[float] = []
    for row in rows:
        if merged_rows and row - merged_rows[-1] < 12:
            merged_rows[-1] = (merged_rows[-1] + row) / 2
        else:
            merged_rows.append(row)
    return merged_columns, merged_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("output")
    parser.add_argument("--rows", type=int, default=25)
    parser.add_argument("--first-question", type=int, default=1)
    parser.add_argument("--threshold", type=float, default=0.30)
    parser.add_argument("--margin", type=float, default=0.10)
    parser.add_argument("--algorithm", default="omr-1")
    args = parser.parse_args()

    image = cv2.imread(args.image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape

    anchors = detect_anchor_squares(gray)
    if len(anchors) != 4:
        raise SystemExit(f"Se esperaban 4 anclas, se detectaron {len(anchors)}")
    source = order_anchor_points(anchors)
    canvas_w, canvas_h = 1000, 930
    target = [[0, 0], [canvas_w, 0], [canvas_w, canvas_h], [0, canvas_h]]

    matrix = cv2.getPerspectiveTransform(np.array(source, dtype=np.float32), np.array(target, dtype=np.float32))
    rectified = cv2.warpPerspective(gray, matrix, (canvas_w, canvas_h))
    columns, rows = detect_grid(rectified)
    if len(columns) % 4 != 0:
        raise SystemExit(f"Columnas no múltiplo de 4: {columns}")
    if len(rows) != args.rows:
        raise SystemExit(f"Filas detectadas {len(rows)} != {args.rows}")

    options = ["A", "B", "C", "D"]
    box_w, box_h = 0.032, 0.036
    bubbles = []
    for row_index, y in enumerate(rows):
        for option_index, option in enumerate(options):
            for column_index in range(len(columns) // 4):
                x = columns[column_index * 4 + option_index]
                question = args.first_question + column_index * args.rows + row_index
                bubbles.append({
                    "questionId": str(question),
                    "optionId": option,
                    "x": round(max(0.0, x / canvas_w - box_w / 2), 4),
                    "y": round(max(0.0, y / canvas_h - box_h / 2), 4),
                    "width": box_w,
                    "height": box_h,
                })

    template = {
        "schemaVersion": 1,
        "canvasWidth": canvas_w,
        "canvasHeight": canvas_h,
        "sourceAnchors": source,
        "targetAnchors": target,
        "threshold": args.threshold,
        "margin": args.margin,
        "algorithmVersion": args.algorithm,
        "bubbles": bubbles,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(template, handle, indent=2, ensure_ascii=False)
    print(json.dumps({"anchors": source, "columns": [round(c, 1) for c in columns], "rows": len(rows), "bubbles": len(bubbles), "output": args.output}))


if __name__ == "__main__":
    main()
