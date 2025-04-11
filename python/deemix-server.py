from os import environ
import unicodedata
import re
import threading
from pathlib import Path
import requests

from deezer import Deezer
from deemix import generateDownloadObject
from deemix.__main__ import LogListener
from deemix.utils import getBitrateNumberFromText
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader

from flask import Flask, request, jsonify

app = Flask(__name__)

listener = LogListener()
local_path = Path('.')
config_folder = local_path / 'config'
settings = loadSettings(config_folder)

arl = environ.get('DEEMIX_ARL')
dz = Deezer()
dz.login_via_arl(arl)

# Fallback-Option von Deezer/Deemix aktivieren oder nicht
FALLBACK_DEEZER = environ.get("FALLBACK_DEEZER", "true").lower() == "true"

# globales Duplikat-Set mit Lock
imported_albums = set()
imported_albums_lock = threading.Lock()


def normalize_title(title: str) -> str:
    if not title:
        return ""
    title = unicodedata.normalize('NFKD', title)
    title = title.encode('ASCII', 'ignore').decode('utf-8').lower()
    title = re.sub(r'[^a-z0-9]', '', title)
    return title


def combine_results(results1, results2, key: str) -> list:
    seen = set()
    combined = []
    for item in results1 + results2:
        val = item.get(key, "")
        norm_val = normalize_title(val)
        if norm_val and norm_val not in seen:
            seen.add(norm_val)
            combined.append(item)
    return combined


def get_search_params():
    return request.args.get('q'), request.args.get('offset'), request.args.get('limit')


@app.route('/search')
def search():
    query, offset, limit = get_search_params()
    return jsonify(dz.api.search_track(query=query, index=offset, limit=limit))


@app.route('/search/artists')
def search_artists():
    query, offset, limit = get_search_params()
    results_deezer = dz.api.search_artist(query=query, index=offset, limit=limit)

    if not FALLBACK_DEEZER:
        try:
            mb_response = requests.get(
                "http://api.lidarr.audio/api/v0.4/musicbrainz/artist",
                params={"query": query, "index": offset, "limit": limit},
                timeout=5
            )
            results_mb = mb_response.json()
            return jsonify(results_mb)
        except Exception as e:
            print(f"[ERROR] Musicbrainz API failed: {e}")
            return jsonify([])

    try:
        mb_response = requests.get(
            "http://api.lidarr.audio/api/v0.4/musicbrainz/artist",
            params={"query": query, "index": offset, "limit": limit},
            timeout=5
        )
        results_mb = mb_response.json()
    except Exception as e:
        print(f"[WARNING] Musicbrainz fallback failed, using only Deezer: {e}")
        results_mb = []

    combined = combine_results(results_mb, results_deezer, key="name")
    return jsonify(combined)


@app.route('/search/albums')
def search_albums():
    query, offset, limit = get_search_params()
    results_deezer = dz.api.search_album(query=query, index=offset, limit=limit)

    if not FALLBACK_DEEZER:
        try:
            mb_response = requests.get(
                "http://api.lidarr.audio/api/v0.4/musicbrainz/album",
                params={"query": query, "index": offset, "limit": limit},
                timeout=5
            )
            results_mb = mb_response.json()
            return jsonify(results_mb)
        except Exception as e:
            print(f"[ERROR] Musicbrainz API failed: {e}")
            return jsonify([])

    try:
        mb_response = requests.get(
            "http://api.lidarr.audio/api/v0.4/musicbrainz/album",
            params={"query": query, "index": offset, "limit": limit},
            timeout=5
        )
        results_mb = mb_response.json()
    except Exception as e:
        print(f"[WARNING] Musicbrainz fallback failed, using only Deezer: {e}")
        results_mb = []

    combined = combine_results(results_mb, results_deezer, key="title")
    return jsonify(combined)


@app.route('/search/advanced')
def advanced_search():
    return jsonify(dz.api.advanced_search(
        track=request.args.get('track'),
        artist=request.args.get('artist'),
        album=request.args.get('album'),
        index=request.args.get('offset'),
        limit=request.args.get('limit')
    ))


@app.route('/albums/<album_id>')
def album(album_id):
    return jsonify(dz.api.get_album(album_id))


@app.route('/artists/<artist_id>')
def artist(artist_id):
    artist_data = dz.api.get_artist(artist_id)
    artist_data.update({'top': dz.api.get_artist_top(artist_id, limit=100)})
    artist_data.update({'albums': dz.api.get_artist_albums(artist_id, limit=200)})
    return jsonify(artist_data)


@app.route('/artists/<artist_id>/top')
def artist_top(artist_id):
    return jsonify(dz.api.get_artist_top(artist_id, limit=100))


@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    return jsonify(dz.api.get_album_tracks(album_id))


@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    return jsonify(dz.api.get_artist_albums(artist_id, limit=200))


@app.route('/dl/<type>/<object_id>', defaults={'bitrate': 'flac'})
@app.route('/dl/<type>/<object_id>/<bitrate>')
def download(type, object_id, bitrate):
    bitrate = getBitrateNumberFromText(bitrate)
    track = generateDownloadObject(dz, f"https://www.deezer.com/us/{type}/{object_id}", bitrate)

    album_title = track.album["title"] if hasattr(track, "album") and track.album and "title" in track.album else track.toDict().get("trackname", "")
    norm_title = normalize_title(album_title)

    with imported_albums_lock:
        if norm_title in imported_albums:
            return jsonify({"status": "skipped", "message": f"Album '{album_title}' wurde bereits importiert."})
        imported_albums.add(norm_title)

    Downloader(dz, track, settings, listener).start()
    return jsonify(track.toDict())


if __name__ == '__main__':
    from waitress import serve
    port = int(environ.get("DEEMIX_PORT", 7272))
    print(f"DeemixApiHelper running at http://0.0.0.0:{port}")
    serve(app, host="0.0.0.0", port=port)
