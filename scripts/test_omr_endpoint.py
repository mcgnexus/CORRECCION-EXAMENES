"""Regresiones del contrato HTTP OMR, sin servidor ni conexiones externas."""

from __future__ import annotations

import base64
import copy
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, ".")
from api.omr import handler  # noqa: E402
from python.omr import process_image  # noqa: E402


class OMREndpointTests(unittest.TestCase):
    def setUp(self):
        self.secret = patch.dict(os.environ, {"INTERNAL_SERVICE_SECRET": "test-only-secret"})
        self.secret.start()
        self.addCleanup(self.secret.stop)
        width, height = 400, 300
        image = np.full((height, width, 3), 255, dtype=np.uint8)
        bubbles = []
        for question, y in (("1", 0.2), ("2", 0.5), ("3", 0.8)):
            for option, x in (("A", 0.2), ("B", 0.6)):
                bubbles.append({"questionId": question, "optionId": option,
                                "x": x, "y": y, "width": 0.1, "height": 0.1})
                if (question, option) in (("1", "A"), ("2", "B")):
                    cv2.rectangle(image, (round(x * width), round(y * height)),
                                  (round((x + 0.1) * width), round((y + 0.1) * height)),
                                  (0, 0, 0), -1)
        ok, encoded = cv2.imencode(".png", image)
        self.assertTrue(ok)
        self.payload = {
            "assetId": "synthetic-sheet",
            "mode": "asset_bytes",
            "imageBase64": base64.b64encode(encoded.tobytes()).decode("ascii"),
            "template": {
                "canvasWidth": width, "canvasHeight": height,
                "sourceAnchors": [[0, 0], [(width - 1) / width, 0],
                                  [(width - 1) / width, (height - 1) / height],
                                  [0, (height - 1) / height]],
                "targetAnchors": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "bubbles": bubbles,
            },
        }

    def post(self, payload, *, secret="test-only-secret", content_length=None):
        body = json.dumps(payload).encode("utf-8")
        request = object.__new__(handler)
        request.headers = {"x-internal-service-secret": secret,
                           "content-length": str(len(body) if content_length is None else content_length)}
        request.rfile = io.BytesIO(body)
        request.wfile = io.BytesIO()
        statuses = []
        request.send_response = statuses.append
        request.send_header = lambda *_args: None
        request.end_headers = lambda: None
        request.do_POST()
        return statuses[0], json.loads(request.wfile.getvalue())

    def assert_rows(self, response):
        self.assertEqual(response["assetId"], "synthetic-sheet")
        rows = response["result"]["rows"]
        self.assertEqual([(row["questionId"], row["status"], row["selectedOptionIds"])
                          for row in rows],
                         [("1", "single", ["A"]), ("2", "single", ["B"]), ("3", "blank", [])])

    def test_public_contract_reads_marked_sheet(self):
        with patch("api.omr.process_image", wraps=process_image) as process:
            status, response = self.post(self.payload)
        self.assertEqual(status, 200, response)
        self.assert_rows(response)
        template = process.call_args.args[1]
        self.assertEqual(template.target_anchors, ((0, 0), (399, 0), (399, 299), (0, 299)))
        np.testing.assert_allclose(template.source_anchors, template.target_anchors)

    def test_pixel_fixtures_and_snake_case_still_read_marked_sheet(self):
        self.payload["mode"] = "synthetic_probe"
        template = self.payload["template"]
        # Los destinos pixel existentes pueden llegar hasta width/height, sin -1.
        template["targetAnchors"] = [[0, 0], [400, 0], [400, 300], [0, 300]]
        template["sourceAnchors"] = copy.deepcopy(template["targetAnchors"])
        for bubble in template["bubbles"]:
            bubble["question_id"] = bubble.pop("questionId")
            bubble["option_id"] = bubble.pop("optionId")
        with patch("api.omr.process_image", wraps=process_image) as process:
            status, response = self.post(self.payload)
        self.assertEqual(status, 200, response)
        self.assert_rows(response)
        self.assertEqual(process.call_args.args[1].target_anchors,
                         tuple(map(tuple, template["targetAnchors"])))

    def test_invalid_bubbles_are_not_silently_accepted(self):
        for changes, removed in (({"unexpected": True}, None), ({}, "questionId"),
                                 ({}, "optionId"), ({"question_id": "other"}, None),
                                 ({"option_id": "other"}, None), ({"x": -0.1}, None),
                                 ({"width": 0}, None), ({"height": 2}, None)):
            with self.subTest(changes=changes, removed=removed):
                payload = copy.deepcopy(self.payload)
                bubble = payload["template"]["bubbles"][0]
                bubble.update(changes)
                if removed:
                    del bubble[removed]
                status, response = self.post(payload)
                self.assertEqual(status, 400, response)
                self.assertEqual(response["error"], "INVALID_OMR_REQUEST")

    def test_invalid_template_is_still_rejected(self):
        for changes in ({"sourceAnchors": [[0, 0]]}, {"targetAnchors": [[0, 0]]},
                        {"canvasWidth": 0}, {"canvasHeight": -1}):
            with self.subTest(changes=changes):
                payload = copy.deepcopy(self.payload)
                payload["template"].update(changes)
                status, response = self.post(payload)
                self.assertEqual(status, 400, response)
                self.assertEqual(response["error"], "INVALID_OMR_REQUEST")

    def test_service_authentication_is_required(self):
        for secret in ("", "wrong-secret"):
            with self.subTest(secret=secret):
                self.assertEqual(self.post(self.payload, secret=secret),
                                 (403, {"error": "SERVICE_AUTH_REQUIRED"}))
        with patch.dict(os.environ, {"INTERNAL_SERVICE_SECRET": ""}):
            self.assertEqual(self.post(self.payload, secret=""),
                             (403, {"error": "SERVICE_AUTH_REQUIRED"}))

    def test_body_size_restrictions_remain(self):
        for length in (0, -1, 15 * 1024 * 1024 + 1):
            with self.subTest(length=length):
                self.assertEqual(self.post(self.payload, content_length=length),
                                 (413, {"error": "INVALID_BODY_SIZE"}))

    def test_url_and_pathname_are_rejected(self):
        for mode in ("asset_bytes", "synthetic_probe", "calibrate"):
            for field in ("imageUrl", "pathname"):
                with self.subTest(mode=mode, field=field):
                    payload = dict(self.payload, mode=mode, **{field: "https://example.invalid/image.png"})
                    status, _ = self.post(payload)
                    self.assertEqual(status, 400)

    def test_asset_id_and_supported_mode_are_required(self):
        payload = dict(self.payload)
        del payload["assetId"]
        self.assertEqual(self.post(payload)[0], 400)
        self.assertEqual(self.post(dict(self.payload, mode="download")),
                         (501, {"error": "UNSUPPORTED_MODE"}))


if __name__ == "__main__":
    unittest.main()
