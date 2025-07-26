from os import environ
from deezer import Deezer, errors
from pathlib import Path

from deemix import generateDownloadObject
from deemix.__main__ import LogListener
from deemix.utils import getBitrateNumberFromText
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader

from flask import Flask, request, jsonify
import unicodedata
import re

app = Flask(__name__)

listener = LogListener()
local_path = Path('.')
config_folder = local_path / 'config'
settings = loadSettings(config_folder)

arl = environ.get('DEEMIX_ARL')

dz = Deezer()
dz.login_via_arl(arl)

def get_search_params():
    return request.args.get('q'), request.args.get('offset'), request.args.get('limit')

# Wrapper, um Deezer API Fehler abzufangen
def deezer_api_call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except errors.DataException:
        # Wenn Deezer "no data" sagt, geben wir einen 404 Fehler zurück
        return jsonify({"error": "Not found on Deezer"}), 404
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/search/artists')
def search_artists():
    (query, offset, limit) = get_search_params()
    return deezer_api_call(dz.api.search_artist, query=query, index=offset, limit=limit)

@app.route('/search/albums')
def search_albums():
    (query, offset, limit) = get_search_params()
    return deezer_api_call(dz.api.search_album, query=query, index=offset, limit=limit)

@app.route('/albums/<album_id>')
def album(album_id):
    return deezer_api_call(dz.api.get_album, album_id)

@app.route('/artists/<artist_id>')
def artist(artist_id):
    try:
        artist_data = dz.api.get_artist(artist_id)
        artist_data.update(artist_data | {'top': dz.api.get_artist_top(artist_id, limit=100)})
        artist_data.update(artist_data | {'albums': dz.api.get_artist_albums(artist_id, limit=200)})
        return artist_data
    except errors.DataException:
        return jsonify({"error": "Artist not found on Deezer"}), 404
    except Exception as e:
        print(f"An unexpected error occurred in artist fetch: {e}")
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    return deezer_api_call(dz.api.get_album_tracks, album_id)

@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    return deezer_api_call(dz.api.get_artist_albums, artist_id, limit=200)

# Der Rest der Datei (Download-Funktion etc.) kann gleich bleiben...
# ... (dein restlicher Python-Code) ...

if __name__ == '__main__':
    from waitress import serve
    print("✅ DeemixApiHelper läuft jetzt stabil unter http://0.0.0.0:7272")
    serve(app, host="0.0.0.0", port=7272)