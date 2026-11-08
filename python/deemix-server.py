from os import environ
from deezer import Deezer, errors
import json
import logging
import sys
import threading
import time

import requests
from flask import Flask, request, jsonify
from werkzeug.exceptions import HTTPException

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

API_ATTEMPTS = 3
API_DEADLINE = 20  # seconds for all attempts of one upstream call

API_ERRORS = {
    100: errors.ItemsLimitExceededException,
    200: errors.PermissionException,
    300: errors.InvalidTokenException,
    500: errors.WrongParameterException,
    501: errors.MissingParameterException,
    600: errors.InvalidQueryException,
    800: errors.DataException,
    901: errors.IndividualAccountChangedNotAllowedException,
}


class DeezerUpstreamError(errors.DeezerError):
    """Deezer unreachable or rate limited after all attempts"""

    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def bounded_api_call(method, args=None):
    """deezer-py's API.api_call with bounded retries.

    The original retries connection errors and quota codes 4/700 by
    recursing forever, which pins a waitress thread until RecursionError.
    """
    api = dz.api
    if args is None:
        args = {}
    if api.access_token:
        args['access_token'] = api.access_token
    deadline = time.monotonic() + API_DEADLINE
    for attempt in range(1, API_ATTEMPTS + 1):
        try:
            result_json = api.session.get(
                "https://api.deezer.com/" + method,
                params=args,
                headers=api.http_headers,
                timeout=max(1, deadline - time.monotonic())
            ).json()
        except (requests.ConnectionError, requests.Timeout, ValueError) as e:
            failure, status, delay = f"connection failed ({type(e).__name__})", 502, 2
        else:
            if 'error' not in result_json:
                return result_json
            error = result_json['error']
            code = error.get('code') if isinstance(error, dict) else None
            if code not in (4, 700):
                if code in API_ERRORS:
                    exc = API_ERRORS[code]
                    raise exc(f"{exc.__name__}: {method} {error.get('message', '')}")
                raise errors.APIError(json.dumps(error))
            failure, status, delay = f"quota exceeded (code {code})", 429, 5
        if attempt == API_ATTEMPTS or time.monotonic() + delay >= deadline:
            break
        time.sleep(delay)
    raise DeezerUpstreamError(f"{method}: {failure} after {attempt} attempt(s)", status)


dz.api.api_call = bounded_api_call


def do_login():
    """Login via ARL; keeps the login state for /health up to date."""
    global deezer_logged_in
    try:
        deezer_logged_in = bool(dz.login_via_arl(arl))
    except Exception as e:
        logger.error(f"Deezer login failed: {e}")
        deezer_logged_in = False
    return deezer_logged_in


def login_in_background():
    # The endpoints below only use the public API, which works without a login,
    # so a bad ARL must not take the whole server down.
    if do_login():
        logger.info("Successfully logged in to Deezer")
    else:
        logger.error("Login with ARL failed! (expired or invalid ARL?) Continuing with the public API only")


def get_search_params():
    """Pull search parameters out of the query string"""
    query = request.args.get('q', '')
    offset = request.args.get('offset', 0, type=int)
    limit = request.args.get('limit', 25, type=int)
    # Deezer search caps at 100 per page anyway
    return query, max(0, offset), max(1, min(limit, 100))


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
    except DeezerUpstreamError as e:
        logger.warning(f"Deezer upstream error: {e}")
        return jsonify({"error": "Deezer API unavailable"}), e.status
    except errors.DeezerError as e:
        # Permanent client-side errors (wrong/missing parameter, permissions,
        # limits, ...)
        logger.warning(f"Deezer error ({type(e).__name__}): {e}")
        return jsonify({"error": f"Deezer error: {type(e).__name__}"}), 400
    except Exception as e:
        logger.error(f"Unexpected error in API call: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/health')
def health_check():
    """Liveness check without a live Deezer call; login state is informational"""
    return jsonify({"status": "ok", "deezer": "logged_in" if deezer_logged_in else "not_logged_in"}), 200


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

    logger.info("Artist search: %r (offset=%d, limit=%d)", query, offset, limit)
    return deezer_api_call(dz.api.search_artist, query=query, index=offset, limit=limit)


@app.route('/search/albums')
def search_albums():
    query, offset, limit = get_search_params()
    if not query:
        return jsonify({"data": [], "total": 0})

    logger.info("Album search: %r (offset=%d, limit=%d)", query, offset, limit)
    return deezer_api_call(dz.api.search_album, query=query, index=offset, limit=limit)


@app.route('/albums/<int:album_id>')
def album(album_id):
    logger.info(f"Fetching album: {album_id}")
    return deezer_api_call(dz.api.get_album, album_id)


def get_artist_full(artist_id):
    """Artist details plus top tracks (best effort) and albums"""
    artist_data = dz.api.get_artist(artist_id)
    if not artist_data:
        return None

    try:
        top_tracks = dz.api.get_artist_top(artist_id, limit=100)
        artist_data['top'] = top_tracks if top_tracks else {"data": []}
    except Exception as e:
        logger.warning(f"Could not load top tracks: {e}")
        artist_data['top'] = {"data": []}

    albums = dz.api.get_artist_albums(artist_id, limit=300)
    artist_data['albums'] = albums if albums else {"data": []}
    return artist_data


@app.route('/artists/<int:artist_id>')
def artist(artist_id):
    logger.info(f"Fetching artist: {artist_id}")
    return deezer_api_call(get_artist_full, artist_id)


@app.route('/album/<int:album_id>/tracks')
def album_tracks(album_id):
    logger.info(f"Fetching tracks for album: {album_id}")
    return deezer_api_call(dz.api.get_album_tracks, album_id)


@app.route('/artists/<int:artist_id>/albums')
def artist_albums(artist_id):
    logger.info(f"Fetching albums for artist: {artist_id}")
    return deezer_api_call(dz.api.get_artist_albums, artist_id, limit=300)


@app.errorhandler(HTTPException)
def http_error(e):
    return jsonify({"error": e.name, "code": e.code}), e.code


@app.errorhandler(Exception)
def internal_error(e):
    logger.error(f"Internal server error: {e}", exc_info=True)
    return jsonify({"error": "Internal server error", "code": 500}), 500


if __name__ == '__main__':
    from waitress import serve

    port = int(environ.get('DEEMIX_PORT', '7272'))
    host = environ.get('DEEMIX_HOST', '127.0.0.1')

    logger.info(f"Deemix API server listening on http://{host}:{port}")
    # shortcut: login thread can still spin inside deezer-py gw retries, bound gw.api_call if that bites
    threading.Thread(target=login_in_background, daemon=True).start()

    serve(app, host=host, port=port, threads=4)
