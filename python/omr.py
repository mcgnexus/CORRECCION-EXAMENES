"""OMR calibrado por plantilla.

Este módulo no decide respuestas correctas y no recibe el solucionario. La entrada
de producción debe resolverse por assetId en el servidor antes de llamar a
process_image; nunca se aceptan URL o rutas proporcionadas por el cliente.
"""

from __future__ import annotations

import base64
import itertools
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
    # Otsu degenera en regiones unimodales (todo oscuro o todo claro); se combina
    # con un umbral fijo y se conserva el mayor de los dos rellenos.
    otsu = cv2.threshold(interior, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    otsu_fill = float(np.mean(otsu > 0))
    fixed_fill = float(np.mean(interior < 100))
    return max(otsu_fill, fixed_fill)


def _load_image(image_or_bytes):
    if isinstance(image_or_bytes, (bytes, bytearray, memoryview)):
        return cv2.imdecode(np.frombuffer(bytes(image_or_bytes), dtype=np.uint8), cv2.IMREAD_COLOR)
    return image_or_bytes


def preprocess_image(image_or_bytes, rotation: float = 0.0, brightness: float = 1.0, contrast: float = 1.0):
    """Aplica rotación (grados), brillo y contraste a una imagen.

    La rotación expande el lienzo para no recortar esquinas y rellena con blanco.
    Brillo y contraste usan la fórmula lineal out = alpha*in + beta con
    alpha=contrast y beta=(brightness-1)*255.
    """

    image = _load_image(image_or_bytes)
    if image is None:
        raise ValueError("El asset no es una imagen válida")
    if rotation:
        height, width = image.shape[:2]
        center = (width / 2.0, height / 2.0)
        matrix = cv2.getRotationMatrix2D(center, float(rotation), 1.0)
        cos = abs(matrix[0, 0])
        sin = abs(matrix[0, 1])
        new_width = int(height * sin + width * cos + 0.5)
        new_height = int(height * cos + width * sin + 0.5)
        matrix[0, 2] += new_width / 2.0 - center[0]
        matrix[1, 2] += new_height / 2.0 - center[1]
        image = cv2.warpAffine(image, matrix, (new_width, new_height), borderValue=(255, 255, 255))
    alpha = float(contrast)
    beta = (float(brightness) - 1.0) * 255.0
    if alpha != 1.0 or beta != 0.0:
        image = cv2.convertScaleAbs(image, alpha=alpha, beta=beta)
    return image


def _pick_anchor_combo(candidates: list[dict[str, float]], width: int, height: int) -> list[dict[str, float]] | None:
    if len(candidates) < 4:
        return None
    best = None
    for combo in itertools.combinations(candidates, 4):
        xs = [p["cx"] for p in combo]
        ys = [p["cy"] for p in combo]
        if max(xs) - min(xs) < width * 0.5 or max(ys) - min(ys) < height * 0.25:
            continue
        has_tl = any(p["cx"] < width / 2 and p["cy"] < height / 2 for p in combo)
        has_tr = any(p["cx"] >= width / 2 and p["cy"] < height / 2 for p in combo)
        has_br = any(p["cx"] >= width / 2 and p["cy"] >= height / 2 for p in combo)
        has_bl = any(p["cx"] < width / 2 and p["cy"] >= height / 2 for p in combo)
        if not (has_tl and has_tr and has_br and has_bl):
            continue
        score = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if best is None or score > best[0]:
            best = (score, combo)
    return [dict(p) for p in best[1]] if best else None


def detect_anchor_squares(gray: np.ndarray) -> list[dict[str, float]]:
    """Detecta hasta cuatro anclas cuadradas negras repartidas por la página."""

    height, width = gray.shape[:2]
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    strict: list[dict[str, float]] = []
    relaxed: list[dict[str, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 100 or area > 4000:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
        # Un cuadrado rotado produce 4-6 vértices tras la aproximación.
        if not 4 <= len(approx) <= 6:
            continue
        x, y, box_w, box_h = cv2.boundingRect(contour)
        if not (8 <= box_w <= 70 and 8 <= box_h <= 70):
            continue
        aspect = box_w / float(box_h)
        fill = area / float(box_w * box_h)
        if not 0.55 < aspect < 1.8 or fill < 0.6:
            continue
        candidate = {"cx": float(x + box_w / 2), "cy": float(y + box_h / 2)}
        relaxed.append(candidate)
        # Nivel estricto: casi cuadrado, muy relleno y pequeño; excluye burbujas
        # (que suelen aproximarse con 6-8 vértices y relleno menor).
        if len(approx) == 4 and 0.75 <= aspect <= 1.3 and fill >= 0.7 and 12 <= box_w <= 45:
            strict.append(candidate)
    # Nivel estricto primero; si no hay combinación válida, el relajado.
    return _pick_anchor_combo(strict, width, height) or _pick_anchor_combo(relaxed, width, height) or []


def detect_bubble_grid(rectified: np.ndarray) -> tuple[list[float], list[float]]:
    """Detecta centros de burbujas en la imagen rectificada y los agrupa en filas/columnas."""

    blur = cv2.GaussianBlur(rectified, (5, 5), 1.2)
    circles = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2, minDist=22, param1=120, param2=26, minRadius=8, maxRadius=18)
    if circles is None:
        return [], []
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


def calibrate_sheet(
    image_or_bytes,
    *,
    rotation: float = 0.0,
    brightness: float = 1.0,
    contrast: float = 1.0,
    canvas_width: int = 1000,
    canvas_height: int = 930,
    expected_rows: int = 25,
) -> dict[str, Any]:
    """Analiza una hoja de calibración con los ajustes manuales indicados.

    Devuelve la imagen preprocesada (para previsualización y ajuste manual de
    anclas), la imagen rectificada (para superponer la rejilla), las anclas
    detectadas en píxeles y normalizadas, y la rejilla de burbujas.
    """

    processed = preprocess_image(image_or_bytes, rotation=rotation, brightness=brightness, contrast=contrast)
    gray = cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    anchors = detect_anchor_squares(gray)
    response: dict[str, Any] = {
        "processedImage": _encode_jpeg(processed, max_width=1200),
        "imageSize": [int(height), int(width)],
        "anchors": [],
        "anchorsNormalized": [],
        "columns": [],
        "rows": [],
        "rectifiedImage": None,
        "detection": "anchors_not_found" if len(anchors) != 4 else "ok",
    }
    if len(anchors) != 4:
        return response

    points = np.array([[a["cx"], a["cy"]] for a in anchors], dtype=np.float32)
    ordered = _order_points(points)
    # El destino se ordena con la misma función que el origen para que la
    # homografía empareje esquinas homólogas (misma convención que _rectify).
    target = _order_points(np.array([[0, 0], [canvas_width, 0], [canvas_width, canvas_height], [0, canvas_height]], dtype=np.float32))
    matrix = cv2.getPerspectiveTransform(ordered, target)
    rectified = cv2.warpPerspective(gray, matrix, (canvas_width, canvas_height))
    columns, rows = detect_bubble_grid(rectified)
    response.update(
        {
            "anchors": [{"cx": round(float(x), 1), "cy": round(float(y), 1)} for x, y in ordered],
            "anchorsNormalized": [[round(float(x) / width, 5), round(float(y) / height, 5)] for x, y in ordered],
            "columns": [round(float(c), 1) for c in columns],
            "rows": [round(float(r), 1) for r in rows],
            "rectifiedImage": _encode_jpeg(rectified, max_width=1000),
            "detection": "ok" if (len(columns) % 4 == 0 and len(rows) == expected_rows) else "grid_mismatch",
        }
    )
    return response


def _encode_jpeg(image: np.ndarray, max_width: int = 1200, quality: int = 80) -> str:
    height, width = image.shape[:2]
    if width > max_width:
        scale = max_width / float(width)
        image = cv2.resize(image, (max_width, int(height * scale + 0.5)), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("No se pudo codificar la imagen")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def process_image(image_or_bytes, template: OMRTemplate, *, threshold: float = 0.35, margin: float = 0.08) -> dict[str, Any]:
    """Rectifica y clasifica burbujas conservando candidatos y métricas.

    Acepta bytes de imagen o un ndarray BGR ya cargado/preprocesado.
    """

    _validate_template(template)
    image = _load_image(image_or_bytes)
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
