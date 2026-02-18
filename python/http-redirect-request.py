"""
Redirect specific HTTP requests to the local Node.js proxy server.

Only intercepts:
  - api.lidarr.audio  → Metadata API (enhanced with Deezer data)
  - ws.audioscrobbler.com → Scrobbler API (proxied through Node.js)

All other hosts (indexers, download clients, notifications, etc.)
pass through mitmproxy as a normal transparent proxy without interference.
"""

import logging
from mitmproxy import http

logger = logging.getLogger("lidarr-deemix")

# Paths on api.lidarr.audio that should NOT be redirected to our proxy
# These are passed through directly to the real API
PASSTHROUGH_PATHS = (
    "/api/v0.4/spotify/",
)

# Hosts we intercept and redirect to our Node.js server
INTERCEPTED_HOSTS = {
    "api.lidarr.audio",
    "ws.audioscrobbler.com",
}

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 7171


def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host

    # Only intercept specific hosts - everything else passes through unchanged
    if host not in INTERCEPTED_HOSTS:
        return

    # api.lidarr.audio: skip certain paths (e.g. Spotify) - let them go direct
    if host == "api.lidarr.audio":
        for path_prefix in PASSTHROUGH_PATHS:
            if flow.request.path.startswith(path_prefix):
                logger.debug(f"Passthrough: {flow.request.path}")
                return

    # Redirect to local Node.js proxy
    flow.request.headers["X-Proxy-Host"] = host
    flow.request.scheme = "http"
    flow.request.host = PROXY_HOST
    flow.request.port = PROXY_PORT
