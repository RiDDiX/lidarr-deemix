import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock

try:
    import requests
    from deezer import errors
except ImportError:  # deps only exist in the container
    errors = None

SERVER = Path(__file__).resolve().parent.parent / "deemix-server.py"


def load_server():
    with mock.patch.dict(os.environ, {"DEEMIX_ARL": "test"}):
        spec = importlib.util.spec_from_file_location("deemix_server", SERVER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


@unittest.skipIf(errors is None, "deezer-py/Flask not installed")
class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_server()
        cls.client = cls.server.app.test_client()

    def params(self, qs):
        with self.server.app.test_request_context("/search/artists?" + qs):
            return self.server.get_search_params()

    def test_search_params_clamped(self):
        self.assertEqual(self.params("q=x&offset=-5&limit=500"), ("x", 0, 100))
        self.assertEqual(self.params("q=x&limit=0"), ("x", 0, 1))
        self.assertEqual(self.params("q=x&offset=abc&limit=abc"), ("x", 0, 25))

    def test_connection_error_gives_up_after_max_attempts(self):
        api = self.server.dz.api
        with mock.patch.object(api.session, "get", side_effect=requests.ConnectionError) as get, \
                mock.patch.object(self.server.time, "sleep") as sleep:
            with self.assertRaises(errors.DeezerError) as ctx:
                api.get_artist(27)
        self.assertEqual(get.call_count, self.server.API_ATTEMPTS)
        self.assertEqual(sleep.call_count, self.server.API_ATTEMPTS - 1)
        self.assertEqual(ctx.exception.status, 502)

    def test_non_json_reply_is_502(self):
        response = mock.Mock()
        response.json.side_effect = ValueError("not JSON")
        with mock.patch.object(self.server.dz.api.session, "get", return_value=response), \
                mock.patch.object(self.server.time, "sleep"), \
                self.assertLogs(self.server.logger, "WARNING"):
            res = self.client.get("/albums/1")
        self.assertEqual(res.status_code, 502)

    def test_quota_error_maps_to_429(self):
        response = mock.Mock()
        response.json.return_value = {"error": {"code": 4, "message": "Quota limit exceeded"}}
        with mock.patch.object(self.server.dz.api.session, "get", return_value=response), \
                mock.patch.object(self.server.time, "sleep"), \
                self.assertLogs(self.server.logger, "WARNING"):
            res = self.client.get("/albums/1")
        self.assertEqual(res.status_code, 429)

    def test_artist_albums_failure_is_502(self):
        api = self.server.dz.api
        with mock.patch.object(api, "get_artist", return_value={"id": 1}), \
                mock.patch.object(api, "get_artist_top", return_value={"data": []}), \
                mock.patch.object(api, "get_artist_albums",
                                  side_effect=self.server.DeezerUpstreamError("down", 502)), \
                self.assertLogs(self.server.logger, "WARNING"):
            res = self.client.get("/artists/1")
        self.assertEqual(res.status_code, 502)

    def test_health_ok_without_login(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), {"status": "ok", "deezer": "not_logged_in"})

    def test_non_int_id_is_json_404(self):
        res = self.client.get("/albums/abc")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.get_json()["code"], 404)


if __name__ == "__main__":
    unittest.main()
