"""OMR calibrado por plantilla.

Este módulo no decide respuestas correctas y no recibe el solucionario. La entrada
de producción debe resolverse por assetId en el servidor antes de llamar a
process_image; nunca se aceptan URL o rutas proporcionadas por el cliente.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class BubbleRegion:
    question_id: str
    option_id: str
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class OMRTemplate:
    canvas_width: int
    canvas_height: int
    source_anchors: tuple[tuple[float, float], ...]
    target_anchors: tuple[tuple[float, float], ...]
    bubbles: tuple[BubbleRegion, ...]
    algorithm_version: str = "omr-1"


def _validate_template(template: OMRTemplate) -> None:
    if len(template.source_anchors) != 4 or len(template.target_anchors) != 4:
        raise ValueError("La plantilla necesita cuatro anclas de origen y destino")
    if template.canvas_width <= 0 or template.canvas_height <= 0:
        raise ValueError("El lienzo canónico debe tener dimensiones positivas")
    for bubble in template.bubbles:
        if not (0 <= bubble.x < 1 and 0 < bubble.width <= 1 and bubble.x + bubble.width <= 1):
            raise ValueError("Región de burbuja fuera de rango horizontal")
        if not (0 <= bubble.y < 1 and 0 < bubble.height <= 1 and bubble.y + bubble.height <= 1):
            raise ValueError("Región de burbuja fuera de rango vertical")


def _order_points(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    return np.array(
        [points[np.argmin(sums)], points[np.argmin(diffs)], points[np.argmax(sums)], points[np.argmax(diffs)]],
        dtype=np.float32,
    )


def _rectify(image: np.ndarray, template: OMRTemplate) -> tuple[np.ndarray, dict[str, Any]]:
    source = _order_points(np.asarray(template.source_anchors, dtype=np.float32))
    target = _order_points(np.asarray(template.target_anchors, dtype=np.float32))
    matrix = cv2.getPerspectiveTransform(source, target)
    rectified = cv2.warpPerspective(image, matrix, (template.canvas_width, template.canvas_height))
    if rectified.size == 0:
        raise ValueError("No se pudo rectificar la imagen")
    return rectified, {"homography": matrix.tolist(), "alignment": "template_anchors"}


def _bubble_fill(gray: np.ndarray, bubble: BubbleRegion) -> float:
    x0 = round(bubble.x * gray.shape[1])
    y0 = round(bubble.y * gray.shape[0])
    x1 = round((bubble.x + bubble.width) * gray.shape[1])
    y1 = round((bubble.y + bubble.height) * gray.shape[0])
    crop = gray[y0:y1, x0:x1]
    if crop.size == 0:
        return 0.0
    # Excluir un borde proporcional para evitar contar el contorno impreso.
    margin_x = max(1, crop.shape[1] // 5)
    margin_y = max(1, crop.shape[0] // 5)
    interior = crop[margin_y:-margin_y or None, margin_x:-margin_x or None]
    if interior.size == 0:
        interior = crop
    threshold = cv2.threshold(interior, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    return float(np.mean(threshold > 0))


def process_image(image_bytes: bytes, template: OMRTemplate, *, threshold: float = 0.35, margin: float = 0.08) -> dict[str, Any]:
    """Rectifica y clasifica burbujas conservando candidatos y métricas."""

    _validate_template(template)
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("El asset no es una imagen válida")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    rectified, alignment = _rectify(gray, template)

    by_question: dict[str, list[dict[str, Any]]] = {}
    for bubble in template.bubbles:
        by_question.setdefault(bubble.question_id, []).append({"optionId": bubble.option_id, "fill": _bubble_fill(rectified, bubble)})

    rows: list[dict[str, Any]] = []
    for question_id, candidates in by_question.items():
        ordered = sorted(candidates, key=lambda item: item["fill"], reverse=True)
        selected = [item for item in ordered if item["fill"] >= threshold]
        status = "blank"
        if selected:
            status = "single" if len(selected) == 1 else "multiple"
            if len(ordered) > 1 and selected[0]["fill"] - ordered[1]["fill"] < margin:
                status = "ambiguous"
        rows.append(
            {
                "questionId": question_id,
                "status": status,
                "selectedOptionIds": [item["optionId"] for item in selected] if status == "single" else [],
                "candidateOptionIds": [item["optionId"] for item in ordered[:2]],
                "metrics": ordered,
                "requiresHumanReview": status in {"multiple", "ambiguous", "unreadable"},
            }
        )

    return {
        "algorithmVersion": template.algorithm_version,
        "canvas": {"width": template.canvas_width, "height": template.canvas_height},
        "alignment": alignment,
        "rows": rows,
    }
