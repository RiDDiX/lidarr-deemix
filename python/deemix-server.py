from os import environ
from deezer import Deezer
from pathlib import Path

from deemix import generateDownloadObject
from deemix.__main__ import LogListener
from deemix.utils import getBitrateNumberFromText
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader

from flask import Flask, request, jsonify
import unicodedata, re

app = Flask(__name__)
listener = LogListener()
settings = loadSettings(Path('.') / 'config')

dz = Deezer()
dz.login_via_arl(environ.get('DEEMIX_ARL'))

def normalize_title(title: str) -> str:
    t = unicodedata.normalize('NFKD', title)
    t = t.encode('ASCII', 'ignore').decode('utf-8').lower()
    t = re.sub(r'[^a-z0-9\s]', '', t).strip()
    return re.sub(r'\s+', ' ', t)

imported = set()

@app.route('/search')
def search_tracks():
    q, offset, limit = request.args.get('q'), request.args.get('offset'), request.args.get('limit')
    return jsonify(dz.api.search_track(query=q, index=offset, limit=limit))

@app.route('/search/artists')
def search_artists():
    q, offset, limit = request.args.get('q'), request.args.get('offset'), request.args.get('limit')
    return jsonify(dz.api.search_artist(query=q, index=offset, limit=limit))

@app.route('/search/albums')
def search_albums():
    q, offset, limit = request.args.get('q'), request.args.get('offset'), request.args.get('limit')
    return jsonify(dz.api.search_album(query=q, index=offset, limit=limit))

@app.route('/artists/<artist_id>')
def artist(artist_id):
    artist = dz.api.get_artist(artist_id)
    artist.update({'top': dz.api.get_artist_top(artist_id, limit=100)})
    artist.update({'albums': dz.api.get_artist_albums(artist_id, limit=200)})
    return jsonify(artist)

@app.route('/albums/<album_id>')
def album(album_id):
    return jsonify(dz.api.get_album(album_id))

@app.route('/dl/<type>/<object_id>', defaults={'bitrate': 'flac'})
@app.route('/dl/<type>/<object_id>/<bitrate>')
def download(type, object_id, bitrate):
    br = getBitrateNumberFromText(bitrate)
    track = generateDownloadObject(dz, f"https://www.deezer.com/us/{type}/{object_id}", br)
    album = track.album.get('title') if getattr(track, 'album', None) else track.toDict().get('trackname', '')
    norm = normalize_title(album)
    if norm in imported:
        return jsonify({"status":"skipped","message":f"Album '{album}' bereits importiert"})
    imported.add(norm)
    Downloader(dz, track, settings, listener).start()
    return jsonify(track.toDict())

if __name__ == '__main__':
    from waitress import serve
    serve(app, host="0.0.0.0", port=7272)
