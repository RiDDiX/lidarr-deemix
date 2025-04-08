"""Redirect HTTP requests to another server."""

from mitmproxy import http

def request(flow: http.HTTPFlow) -> None:
    # Sonderfall: Bei diesem speziellen URL-Pfad keine Umleitung vornehmen.
    if flow.request.pretty_host == "https://api.lidarr.audio/api/v0.4/spotify/":
        return

    # Prüfe, ob der Request entweder an "api.lidarr.audio" oder "ws.audioscrobbler.com" geht
    # ODER ob der Host "localhost" ist und Port 3000 verwendet wird.
    if (flow.request.pretty_host in ["api.lidarr.audio", "ws.audioscrobbler.com"]) or \
       (flow.request.host == "localhost" and flow.request.port == 3000):
        # Speichere den ursprünglichen Host in einem Header, falls benötigt.
        flow.request.headers["X-Proxy-Host"] = flow.request.pretty_host
        # Setze Schema, Host und Port so, dass die Anfrage an 127.0.0.1:7171 umgeleitet wird.
        flow.request.scheme = "http"
        flow.request.host = "127.0.0.1"
        flow.request.port = 7171
