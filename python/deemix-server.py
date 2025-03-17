from os import environ
from deezer import Deezer
from pathlib import Path

from deemix import generateDownloadObject
from deemix.__main__ import LogListener
from deemix.utils import getBitrateNumberFromText
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader

from flask import Flask, request
import unicodedata
import re

app = Flask(__name__)

listener = LogListener()
local_path = Path('.')
config_folder = local_path / 'config'
settings = loadSettings(config_folder)

arl = environ.get('DEEMIX_ARL')
# arl = 'ARL'

dz = Deezer()
dz.login_via_arl(arl)

def get_search_params():
    return request.args.get('q'), request.args.get('offset'), request.args.get('limit')

@app.route('/search')
def search():
    (query, offset, limit) = get_search_params()
    return dz.api.search_track(query=query, index=offset, limit=limit)

@app.route('/search/artists')
def search_artists():
    (query, offset, limit) = get_search_params()
    return dz.api.search_artist(query=query, index=offset, limit=limit)

@app.route('/search/albums')
def search_albums():
    (query, offset, limit) = get_search_params()
    return dz.api.search_album(query=query, index=offset, limit=limit)

@app.route('/search/advanced')
def advanced_search():
    (query, offset, limit) = get_search_params()
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
    artist = dz.api.get_artist(artist_id)
    # Ergänze Top-Tracks und Alben
    artist.update(artist | {'top': dz.api.get_artist_top(artist_id, limit=100)})
    artist.update(artist | {'albums': dz.api.get_artist_albums(artist_id, limit=200)})
    return artist

@app.route('/artists/<artist_id>/top')
def artist_top(artist_id):
    return dz.api.get_artist_top(artist_id, limit=100)

@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    return dz.api.get_album_tracks(album_id)

@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    return dz.api.get_artist_albums(artist_id, limit=200)

# Globales Set zur Speicherung der bereits importierten Alben (über normalisierte Albumtitel)
imported_albums = set()

def normalize_title(title: str) -> str:
    # Entferne Akzente, wandle in Kleinbuchstaben und entferne Sonderzeichen
    title = unicodedata.normalize('NFKD', title)
    title = title.encode('ASCII', 'ignore').decode('utf-8').lower()
    title = re.sub(r'[^a-z0-9\s]', '', title)
    title = re.sub(r'\s+', ' ', title).strip()
    return title

@app.route('/dl/<type>/<object_id>', defaults={'bitrate': 'flac'})
@app.route('/dl/<type>/<object_id>/<bitrate>')
def download(type, object_id, bitrate):
    bitrate = getBitrateNumberFromText(bitrate)
    # Erzeuge das Download-Objekt
    track = generateDownloadObject(dz, f"https://www.deezer.com/us/{type}/{object_id}", bitrate)
    
    # Angenommen, das Track-Objekt enthält Album-Informationen (z.B. track.album['title'])
    album_title = None
    if hasattr(track, "album") and track.album and "title" in track.album:
        album_title = track.album["title"]
    else:
        # Falls Albumtitel nicht vorhanden ist, kann man alternativ den Tracktitel nutzen
        album_title = track.toDict().get("trackname", "")
    
    norm_title = normalize_title(album_title)
    
    if norm_title in imported_albums:
        # Album wurde bereits importiert – überspringe den Download
        return {"status": "skipped", "message": f"Album '{album_title}' wurde bereits importiert."}
    
    # Füge den normalisierten Titel zu den importierten Alben hinzu
    imported_albums.add(norm_title)
    
    # Starte den Downloader
    Downloader(dz, track, settings, listener).start()
    return track.toDict()

if __name__ == '__main__':
    from waitress import serve
    print("DeemixApiHelper running at http://0.0.0.0:7272")
    serve(app, host="0.0.0.0", port=7272)
