"""Función Python OMR para Vercel.

El endpoint no acepta URL, pathname ni bytes de clientes. La prueba sintética
usa un secreto de servicio y queda separada del flujo de producción; el flujo
real deberá resolver assetId desde Blob en una capa autorizada.
"""

from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any

from python.omr import BubbleRegion, OMRTemplate, process_image


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        _json_response(self, 200, {"ok": True, "opencvVersion": __import__("cv2").__version__})

    def do_POST(self) -> None:
        expected_secret = os.environ.get("INTERNAL_SERVICE_SECRET")
        if not expected_secret or self.headers.get("x-internal-service-secret") != expected_secret:
            _json_response(self, 403, {"error": "SERVICE_AUTH_REQUIRED"})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            if content_length <= 0 or content_length > 15 * 1024 * 1024:
                _json_response(self, 413, {"error": "INVALID_BODY_SIZE"})
                return
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict) or not isinstance(payload.get("assetId"), str):
                _json_response(self, 400, {"error": "assetId es obligatorio"})
                return
            if payload.get("imageUrl") or payload.get("pathname"):
                _json_response(self, 400, {"error": "No se aceptan URL ni pathname"})
                return
            if payload.get("mode") != "synthetic_probe" or not isinstance(payload.get("imageBase64"), str):
                _json_response(self, 501, {"error": "ASSET_RESOLVER_PENDING"})
                return

            template_data = payload.get("template")
            if not isinstance(template_data, dict):
                _json_response(self, 400, {"error": "template es obligatorio"})
                return
            template = OMRTemplate(
                canvas_width=int(template_data["canvasWidth"]),
                canvas_height=int(template_data["canvasHeight"]),
                source_anchors=tuple(tuple(point) for point in template_data["sourceAnchors"]),
                target_anchors=tuple(tuple(point) for point in template_data["targetAnchors"]),
                bubbles=tuple(BubbleRegion(**bubble) for bubble in template_data.get("bubbles", [])),
                algorithm_version=str(template_data.get("algorithmVersion", "omr-1")),
            )
            result = process_image(base64.b64decode(payload["imageBase64"], validate=True), template)
            _json_response(self, 200, {"assetId": payload["assetId"], "result": result})
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            _json_response(self, 400, {"error": "INVALID_OMR_REQUEST", "detail": str(error)})
        except Exception:
            _json_response(self, 500, {"error": "OMR_PROCESSING_FAILED"})

    def log_message(self, _format: str, *_args: Any) -> None:
        return
