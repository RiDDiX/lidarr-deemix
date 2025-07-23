// Für beide Quellen: saubere Artist-Struktur erzeugen!
export function cleanArtist(a: any) {
  return {
    id: a.id || a.artist_id || a.MusicBrainzId || a.musicbrainz_id,
    name: a.name || a.artistName || a.title,
    type: a.type || a.artistType,
    source: a.source || (a.MusicBrainzId ? 'lidarr' : 'deezer'),
    ...a
  }
}
