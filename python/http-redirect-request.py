from mitmproxy import http

def request(flow: http.HTTPFlow) -> None:
    # Sonderfall: Spotify nicht umleiten
    if flow.request.pretty_host == "https://api.lidarr.audio/api/v0.4/spotify/":
        return
    
    # Prüfe, ob der Request entweder an "api.lidarr.audio",
    # "ws.audioscrobbler.com" oder an "localhost" (mit Port 3000) erfolgt.
    if (flow.request.pretty_host in ["api.lidarr.audio", "ws.audioscrobbler.com"]) \
       or (flow.request.host == "localhost" and flow.request.port == 3000) \
       or ("localhost:3000" in flow.request.pretty_host):
        flow.request.headers["X-Proxy-Host"] = flow.request.pretty_host
        flow.request.scheme = "http"
        flow.request.host = "127.0.0.1"
        flow.request.port = 7171
