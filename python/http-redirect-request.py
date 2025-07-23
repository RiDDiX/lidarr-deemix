import json
import requests
from mitmproxy import http

# URL and port of your local Deemix/Deezer service
DEEMIX_URL = "http://127.0.0.1:7272/search/artists"
# Host header of the real Lidarr metadata API
LIDARR_HOST = "api.lidarr.audio"
# External Lidarr API endpoint
LIDARR_API = "https://api.lidarr.audio"

# Map a Deezer artist object to the expected Lidarr/MB artist schema
def convert_deezer_to_lidarr(a: dict) -> dict:
    return {
        "artistId": 0,
        "metadataProvider": "Deezer",
        "foreignArtistId": a.get("id"),
        "artistName": a.get("name"),
        "score": a.get("nb_fan", 0),
        "releaseCount": a.get("nb_album", 0)
    }

# Intercept responses from Lidarr search
def response(flow: http.HTTPFlow) -> None:
    # Only handle Lidarr search requests
    if flow.request.pretty_host == LIDARR_HOST and flow.request.path.startswith("/api/v1/search"):
        try:
            # Original JSON from Lidarr
            orig = flow.response.json()
            artists = orig.get("artists") or []
        except ValueError:
            artists = []

        # Query parameter for search term
        query = flow.request.query.get("term", "")
        # Fetch Deezer results
        try:
            r = requests.get(DEEMIX_URL, params={"q": query}, timeout=2)
            r.raise_for_status()
            data = r.json().get("data", [])
            deezer_mapped = [convert_deezer_to_lidarr(a) for a in data]
        except Exception:
            deezer_mapped = []

        # Merge and dedupe by lowercase name
        merged = {a.get("artistName", "").lower(): a for a in artists}
        for a in deezer_mapped:
            key = a.get("artistName", "").lower()
            if key not in merged:
                merged[key] = a

        # Build new response
        new = {"artists": list(merged.values())}
        flow.response.text = json.dumps(new)