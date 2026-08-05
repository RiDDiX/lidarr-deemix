from os import environ
from deezer import Deezer, errors
import logging
import sys

from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

arl = environ.get('DEEMIX_ARL')
if not arl:
    logger.error("DEEMIX_ARL environment variable is not set!")
    sys.exit(1)

# Deezer login
dz = Deezer()
deezer_logged_in = False


def do_login():
    """Login via ARL; keeps the login state for /health up to date."""
    global deezer_logged_in
    try:
        deezer_logged_in = bool(dz.login_via_arl(arl))
    except Exception as e:
        logger.error(f"Deezer login failed: {e}")
        deezer_logged_in = False
    return deezer_logged_in


if not do_login():
    logger.error("Login with ARL failed! (expired or invalid ARL?)")
    sys.exit(1)
logger.info("Successfully logged in to Deezer")


def get_search_params():
    """Pull search parameters out of the query string"""
    query = request.args.get('q', '')
    offset = request.args.get('offset', '0')
    limit = request.args.get('limit', '25')

    try:
        offset = int(offset)
        limit = min(int(limit), 100)  # Deezer search caps at 100 per page anyway
    except ValueError:
        offset = 0
        limit = 25

    return query, offset, limit


def deezer_api_call(func, *args, **kwargs):
    """Wrapper for Deezer API calls with error handling"""
    try:
        result = func(*args, **kwargs)
        if result is None:
            return jsonify({"error": "No data found"}), 404
        return jsonify(result)
    except errors.DataException as e:
        logger.warning(f"Deezer DataException: {e}")
        return jsonify({"error": "Not found on Deezer"}), 404
    except (errors.InvalidTokenException, errors.GWAPIError) as e:
        # Auth/session related - deezer-py has no LoginError, these two are
        # the cases where a fresh ARL login can actually help
        logger.warning(f"Deezer error ({type(e).__name__}): {e} - trying re-login")
        try:
            if do_login():
                result = func(*args, **kwargs)
                if result is None:
                    return jsonify({"error": "No data found"}), 404
                return jsonify(result)
        except Exception as retry_error:
            logger.error(f"Retry after re-login failed: {retry_error}")
        return jsonify({"error": "Deezer API error"}), 502
    except errors.DeezerError as e:
        # Permanent client-side errors (wrong/missing parameter, permissions,
        # limits, ...) - a re-login would not change anything here
        logger.warning(f"Deezer error ({type(e).__name__}): {e}")
        return jsonify({"error": f"Deezer error: {type(e).__name__}"}), 400
    except Exception as e:
        logger.error(f"Unexpected error in API call: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/health')
def health_check():
    """Health check without a live Deezer call (login state only)"""
    if deezer_logged_in:
        return jsonify({"status": "healthy", "deezer": "logged_in"}), 200
    return jsonify({"status": "unhealthy", "deezer": "not_logged_in"}), 503


@app.route('/health/deep')
def health_check_deep():
    """Health check with a live Deezer API call (manual diagnostics)"""
    try:
        test = dz.api.get_artist(27)  # Daft Punk as canary
        if test:
            return jsonify({"status": "healthy", "deezer": "connected"}), 200
    except Exception as e:
        logger.warning(f"Deep health check failed: {e}")
    return jsonify({"status": "unhealthy", "deezer": "disconnected"}), 503


@app.route('/search/artists')
def search_artists():
    query, offset, limit = get_search_params()
    if not query:
        return jsonify({"data": [], "total": 0})

    logger.info(f"Artist search: '{query}' (offset={offset}, limit={limit})")
    return deezer_api_call(dz.api.search_artist, query=query, index=offset, limit=limit)


@app.route('/search/albums')
def search_albums():
    query, offset, limit = get_search_params()
    if not query:
        return jsonify({"data": [], "total": 0})

    logger.info(f"Album search: '{query}' (offset={offset}, limit={limit})")
    return deezer_api_call(dz.api.search_album, query=query, index=offset, limit=limit)


@app.route('/albums/<album_id>')
def album(album_id):
    try:
        album_id = int(album_id)
    except ValueError:
        return jsonify({"error": "Invalid album ID"}), 400

    logger.info(f"Fetching album: {album_id}")
    return deezer_api_call(dz.api.get_album, album_id)


@app.route('/artists/<artist_id>')
def artist(artist_id):
    """Artist details including top tracks and albums"""
    try:
        artist_id = int(artist_id)
    except ValueError:
        return jsonify({"error": "Invalid artist ID"}), 400

    logger.info(f"Fetching artist: {artist_id}")

    try:
        artist_data = dz.api.get_artist(artist_id)
        if not artist_data:
            return jsonify({"error": "Artist not found"}), 404

        try:
            top_tracks = dz.api.get_artist_top(artist_id, limit=100)
            artist_data['top'] = top_tracks if top_tracks else {"data": []}
        except Exception as e:
            logger.warning(f"Could not load top tracks: {e}")
            artist_data['top'] = {"data": []}

        try:
            albums = dz.api.get_artist_albums(artist_id, limit=300)
            artist_data['albums'] = albums if albums else {"data": []}
        except Exception as e:
            logger.warning(f"Could not load albums: {e}")
            artist_data['albums'] = {"data": []}

        return jsonify(artist_data)

    except errors.DataException:
        return jsonify({"error": "Artist not found on Deezer"}), 404
    except Exception as e:
        logger.error(f"Unexpected error in artist fetch: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/album/<album_id>/tracks')
def album_tracks(album_id):
    try:
        album_id = int(album_id)
    except ValueError:
        return jsonify({"error": "Invalid album ID"}), 400

    logger.info(f"Fetching tracks for album: {album_id}")
    return deezer_api_call(dz.api.get_album_tracks, album_id)


@app.route('/artists/<artist_id>/albums')
def artist_albums(artist_id):
    try:
        artist_id = int(artist_id)
    except ValueError:
        return jsonify({"error": "Invalid artist ID"}), 400

    logger.info(f"Fetching albums for artist: {artist_id}")
    return deezer_api_call(dz.api.get_artist_albums, artist_id, limit=300)


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
║           Deemix API server started                ║
╠════════════════════════════════════════════════════╣
║  URL: http://{host}:{port}
║  ARL: {'✓ set' if arl else '✗ missing'}
║  Endpoints:
║   - /health                  (health check)
║   - /health/deep             (health check with live API call)
║   - /search/artists          (artist search)
║   - /search/albums           (album search)
║   - /artists/<id>            (artist details)
║   - /albums/<id>             (album details)
║   - /album/<id>/tracks       (album tracks)
║   - /artists/<id>/albums     (artist albums)
╚════════════════════════════════════════════════════╝
    """)

    serve(app, host=host, port=port, threads=4)
