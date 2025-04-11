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

from flask import Flask, request

app = Flask(__name__)

listener = LogListener()
local_path = Path('.')
config_folder = local_path / 'config'
settings = loadSettings(config_folder)

arl = environ.get('DEEMIX_ARL')
dz = Deezer()
dz.login_via_arl(arl)

# Lese die Umgebungsvariable FALLBACK_DEEZER, Standard: true
FALLBACK_DEEZER = environ.get("FALLBACK_DEEZER", "true").lower() == "true"

def get_search_params():
    return request.args.get('q'), request.args.get('offset'), request.args.get('limit')

def normalize_title(title: str) -> str:
    title = unicodedata.normalize('NFKD', title)
    title = title.encode('ASCII', 'ignore').decode('utf-8').lower()
    title = re.sub(r'[^a-z0-9\s]', '', title)
    title = re.sub(r'\s+', ' ', title).strip()
    return title

def combine_results(results1, results2, key: str) -> list:
    """Kombiniert zwei Listen von Ergebnissen und entfernt Duplikate anhand eines Schlüssels."""
    seen = set()
    combined = []
    for item in results1 + results2:
        val = item.get(key, "")
        norm_val = normalize_title(val)
        if norm_val and norm_val not in seen:
            seen.add(norm_val)
            combined.append(item)
    return combined

@app.route('/search')
def search():
    query, offset, limit = get_search_params()
    return dz.api.search_track(query=query, index=offset, limit=limit)

@app.route('/search/artists')
def search_artists():
    query, offset, limit = get_search_params()
    results_deezer = dz.api.search_artist(query=query, index=offset, limit=limit)
    if FALLBACK_DEEZER:
        return results_deezer
    else:
        try:
            # Beispielhafter Aufruf an den MusicBrainz-Endpunkt über api.lidarr.audio
            mb_response = requests.get(
                "http://api.lidarr.audio/api/v0.4/musicbrainz/artist",
                params={"query": query, "index": offset, "limit": limit},
                timeout=5
            )
            results_mb = mb_response.json()
        except Exception as e:
            results_mb = []
        combined = combine_results(results_deezer, results_mb, key="name")
        return combined

@app.route('/search/albums')
def search_albums():
    query, offset, limit = get_search_params()
    results_deezer = dz.api.search_album(query=query, index=offset, limit=limit)
    if FALLBACK_DEEZER:
        return results_deezer
    else:
        try:
            mb_response = requests.get(
                "http://api.lidarr.audio/api/v0.4/musicbrainz/album",
                params={"query": query, "index": offset, "limit": limit},
                timeout=5
            )
            results_mb = mb_response.json()
        except Exception as e:
            results_mb = []
        combined = combine_results(results_deezer, results_mb, key="title")
        return combined

@app.route('/search/advanced')
def advanced_search():
    query, offset, limit = get_search_params()
    return dz.api.advanced_search(
        track=request.args.get('track'),
        artist=request.args.get('artist'),
        album=request.args.get('album'),
        index=offset,
        limit=limit
    )

@app.route('/albums/<album_id>')
def album(album_id):
    return dz.api.get_album(album_id)

@app.route('/artists/<artist_id>')
def artist(artist_id):
    artist_data = dz.api.get_artist(artist_id)
    artist_data.update(artist_data | {'top': dz.api.get_artist_top(artist_id, limit=100)})
    artist_data.update(artist_data | {'albums': dz.api.get_artist_albums(artist_id, limit=200)})
    return artist_data

@app.route('/artists/<artist_id>/top')
def artist_top(artist_id):
    return dz.api.get_artist_top(artist_id, limit=100)

@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    return dz.api.get_album_tracks(album_id)

@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    return dz.api.get_artist_albums(artist_id, limit=200)

# Globales Set und Lock zur thread-sicheren Handhabung importierter Alben
imported_albums = set()
imported_albums_lock = threading.Lock()

@app.route('/dl/<type>/<object_id>', defaults={'bitrate': 'flac'})
@app.route('/dl/<type>/<object_id>/<bitrate>')
def download(type, object_id, bitrate):
    bitrate = getBitrateNumberFromText(bitrate)
    track = generateDownloadObject(dz, f"https://www.deezer.com/us/{type}/{object_id}", bitrate)
    
    # Versuche, den Albumtitel zu ermitteln (bevorzugt aus track.album, sonst aus track.toDict())
    if hasattr(track, "album") and track.album and "title" in track.album:
        album_title = track.album["title"]
    else:
        album_title = track.toDict().get("trackname", "")
    
    norm_title = normalize_title(album_title)
    
    with imported_albums_lock:
        if norm_title in imported_albums:
            return {"status": "skipped", "message": f"Album '{album_title}' wurde bereits importiert."}
        imported_albums.add(norm_title)
    
    Downloader(dz, track, settings, listener).start()
    return track.toDict()

if __name__ == '__main__':
    from waitress import serve
    print("DeemixApiHelper running at http://0.0.0.0:7272")
    serve(app, host="0.0.0.0", port=7272)
