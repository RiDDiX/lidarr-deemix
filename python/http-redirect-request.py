from mitmproxy import http

def request(flow: http.HTTPFlow) -> None:
    if flow.request.pretty_host == "api.lidarr.audio":
        flow.request.scheme = "http"
        flow.request.host   = "127.0.0.1"
        flow.request.port   = 8080