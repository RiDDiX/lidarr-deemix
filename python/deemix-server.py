from os import environ
from deezer import Deezer, errors
from pathlib import Path
import logging
import sys

from deemix import generateDownloadObject
from deemix.__main__ import LogListener
from deemix.utils import getBitrateNumberFromText
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader

from flask import Flask, request, jsonify
import unicodedata
import re

# Logging konfigurieren
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Deemix Setup
listener = LogListener()
local_path = Path('.')
config_folder = local_path / 'config'
settings = loadSettings(config_folder)

arl = environ.get('DEEMIX_ARL')
if not arl:
    logger.error("DEEMIX_ARL Umgebungsvariable nicht gesetzt!")
    sys.exit(1)

# Deezer Login
dz = Deezer()
try:
    if not dz.login_via_arl(arl):
        logger.error("Login mit ARL fehlgeschlagen!")
        sys.exit(1)
    logger.info("Erfolgreich bei Deezer eingeloggt")
except Exception as e:
    logger.error(f"Fehler beim Deezer-Login: {e}")
    sys.exit(1)

def get_search_params():
    """Extrahiert Suchparameter aus Query-String"""
    query = request.args.get('q', '')
    offset = request.args.get('offset', '0')
    limit = request.args.get('limit', '25')
    
    try:
        offset = int(offset)
        limit = min(int(limit), 100)  # Max 100 Ergebnisse
    except ValueError:
        offset = 0
        limit = 25
    
    return query, offset, limit

def deezer_api_call(func, *args, **kwargs):
    """Wrapper für Deezer API Calls mit Error Handling"""
    try:
        result = func(*args, **kwargs)
        if result is None:
            return jsonify({"error": "No data found"}), 404
        return jsonify(result)
    except errors.DataException as e:
        logger.warning(f"Deezer DataException: {e}")
        return jsonify({"error": "Not found on Deezer"}), 404
    except errors.LoginError as e:
        logger.error(f"Deezer Login Error: {e}")
        # Versuche erneut einzuloggen
        try:
            dz.login_via_arl(arl)
            result = func(*args, **kwargs)
            return jsonify(result) if result else (jsonify({"error": "No data"}), 404)
        except:
            return jsonify({"error": "Authentication failed"}), 401
    except Exception as e:
        logger.error(f"Unexpected error in API call: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/health')
def health_check():
    """Health Check Endpoint"""
    try:
        # Teste Deezer-Verbindung
        test = dz.api.get_artist(27)  # Daft Punk als Test
        if test:
            return jsonify({"status": "healthy", "deezer": "connected"}), 200
    except:
        pass
    return jsonify({"status": "unhealthy", "deezer": "disconnected"}), 503

@app.route('/search/artists')
def search_artists():
    """Suche nach Künstlern"""
    query, offset, limit = get_search_params()
    if not query:
        return jsonify({"data": [], "total": 0})
    
    logger.info(f"Suche Künstler: '{query}' (offset={offset}, limit={limit})")
    return deezer_api_call(dz.api.search_artist, query=query, index=offset, limit=limit)

@app.route('/search/albums')
def search_albums():
    """Suche nach Alben"""
    query, offset, limit = get_search_params()
    if not query:
        return jsonify({"data": [], "total": 0})
    
    logger.info(f"Suche Alben: '{query}' (offset={offset}, limit={limit})")
    return deezer_api_call(dz.api.search_album, query=query, index=offset, limit=limit)

@app.route('/albums/<album_id>')
def album(album_id):
    """Hole Album-Details"""
    try:
        album_id = int(album_id)
    except ValueError:
        return jsonify({"error": "Invalid album ID"}), 400
    
    logger.info(f"Hole Album: {album_id}")
    return deezer_api_call(dz.api.get_album, album_id)

@app.route('/artists/<artist_id>')
def artist(artist_id):
    """Hole Künstler-Details mit Top-Tracks und Alben"""
    try:
        artist_id = int(artist_id)
    except ValueError:
        return jsonify({"error": "Invalid artist ID"}), 400
    
    logger.info(f"Hole Künstler: {artist_id}")
    
    try:
        # Basis-Künstler-Daten
        artist_data = dz.api.get_artist(artist_id)
        if not artist_data:
            return jsonify({"error": "Artist not found"}), 404
        
        # Erweitere mit Top-Tracks
        try:
            top_tracks = dz.api.get_artist_top(artist_id, limit=100)
            artist_data['top'] = top_tracks if top_tracks else {"data": []}
        except Exception as e:
            logger.warning(f"Konnte Top-Tracks nicht laden: {e}")
            artist_data['top'] = {"data": []}
        
        # Erweitere mit Alben
        try:
            albums = dz.api.get_artist_albums(artist_id, limit=300)
            artist_data['albums'] = albums if albums else {"data": []}
        except Exception as e:
            logger.warning(f"Konnte Alben nicht laden: {e}")
            artist_data['albums'] = {"data": []}
        
        return jsonify(artist_data)
        
    except errors.DataException:
        return jsonify({"error": "Artist not found on Deezer"}), 404
    except Exception as e:
        logger.error(f"Unexpected error in artist fetch: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    """Hole Album-Tracks"""
    try:
        album_id = int(album_id)
    except ValueError:
        return jsonify({"error": "Invalid album ID"}), 400
    
    logger.info(f"Hole Tracks für Album: {album_id}")
    return deezer_api_call(dz.api.get_album_tracks, album_id)

@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    """Hole alle Alben eines Künstlers"""
    try:
        artist_id = int(artist_id)
    except ValueError:
        return jsonify({"error": "Invalid artist ID"}), 400
    
    logger.info(f"Hole Alben für Künstler: {artist_id}")
    return deezer_api_call(dz.api.get_artist_albums, artist_id, limit=300)

@app.route('/download', methods=['POST'])
def download():
    """Download-Endpoint für Deemix"""
    try:
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({"error": "URL required"}), 400
        
        url = data['url']
        bitrate = data.get('bitrate', 'FLAC')
        download_path = data.get('path', './downloads')
        
        logger.info(f"Starte Download: {url} ({bitrate})")
        
        # Konvertiere Bitrate
        bitrate_num = getBitrateNumberFromText(bitrate)
        
        # Erstelle Download-Objekt
        download_obj = generateDownloadObject(dz, url, bitrate_num)
        
        if not download_obj:
            return jsonify({"error": "Invalid URL or content not found"}), 400
        
        # Starte Download
        downloader = Downloader(dz, download_obj, settings, listener)
        result = downloader.start()
        
        return jsonify({
            "status": "success",
            "download": result
        })
        
    except Exception as e:
        logger.error(f"Download error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Internal server error: {e}", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    from waitress import serve
    
    port = int(environ.get('DEEMIX_PORT', '7272'))
    host = environ.get('DEEMIX_HOST', '0.0.0.0')
    
    logger.info(f"""
╔════════════════════════════════════════════════════╗
║         Deemix API Server gestartet                ║
╠════════════════════════════════════════════════════╣
║  URL: http://{host}:{port}                        
║  ARL: {'✓ Gesetzt' if arl else '✗ Fehlt'}
║  Endpoints:
║   - /health                  (Health Check)
║   - /search/artists          (Künstler suchen)
║   - /search/albums           (Alben suchen)
║   - /artists/<id>            (Künstler-Details)
║   - /albums/<id>             (Album-Details)
║   - /album/<id>/tracks       (Album-Tracks)
║   - /artists/<id>/albums     (Künstler-Alben)
╚════════════════════════════════════════════════════╝
    """)
    
    serve(app, host=host, port=port, threads=4)