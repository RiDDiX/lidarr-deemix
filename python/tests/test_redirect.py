import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ADDON = Path(__file__).resolve().parent.parent / "http-redirect-request.py"


def load_addon():
    # mitmproxy is only installed in the container; the addon just needs http.HTTPFlow
    stub = types.ModuleType("mitmproxy")
    stub.http = SimpleNamespace(HTTPFlow=object)
    with mock.patch.dict(sys.modules, {"mitmproxy": stub}):
        spec = importlib.util.spec_from_file_location("redirect_addon", ADDON)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def make_flow(host, path="/api/v0.4/search"):
    return SimpleNamespace(request=SimpleNamespace(
        pretty_host=host, path=path, headers={}, scheme="https", host=host, port=443))


class RedirectTest(unittest.TestCase):
    def setUp(self):
        with mock.patch.dict(os.environ, {"PROXY_PORT": "7171"}):
            self.addon = load_addon()

    def test_redirects_intercepted_host_case_and_trailing_dot(self):
        flow = make_flow("API.lidarr.audio.")
        self.addon.request(flow)
        self.assertEqual(flow.request.scheme, "http")
        self.assertEqual(flow.request.host, "127.0.0.1")
        self.assertEqual(flow.request.port, 7171)
        self.assertEqual(flow.request.headers["X-Proxy-Host"], "api.lidarr.audio")

    def test_other_host_passes_through(self):
        flow = make_flow("example.com")
        self.addon.request(flow)
        self.assertEqual((flow.request.scheme, flow.request.host, flow.request.port),
                         ("https", "example.com", 443))
        self.assertNotIn("X-Proxy-Host", flow.request.headers)

    def test_spotify_path_passes_through(self):
        flow = make_flow("api.lidarr.audio", "/api/v0.4/spotify/album/1")
        self.addon.request(flow)
        self.assertEqual(flow.request.host, "api.lidarr.audio")

    def test_invalid_proxy_port_falls_back(self):
        for value in ("abc", "0", "70000"):
            with mock.patch.dict(os.environ, {"PROXY_PORT": value}):
                with self.assertLogs("lidarr-deemix", "WARNING"):
                    self.assertEqual(load_addon().PROXY_PORT, 7171)


if __name__ == "__main__":
    unittest.main()
