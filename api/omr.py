"""Punto de entrada reservado para Vercel Python.

La integración de producción debe resolver un asset autorizado desde Blob usando
el servicio interno. Rechaza deliberadamente URL, pathname y bytes del cliente
hasta que ese resolver y la autorización de servicio estén desplegados.
"""

from typing import Any


def handler(request: Any) -> dict[str, Any]:
    body = request.get_json() if hasattr(request, "get_json") else {}
    if not isinstance(body, dict) or not body.get("assetId"):
        return {"statusCode": 400, "body": {"error": "assetId es obligatorio"}}
    if body.get("imageUrl") or body.get("pathname") or body.get("imageBytes"):
        return {"statusCode": 400, "body": {"error": "No se aceptan referencias arbitrarias ni bytes del cliente"}}
    return {"statusCode": 503, "body": {"error": "OMR_REQUIRES_VERIFIED_ASSET_RESOLVER"}}
