import fetch from "node-fetch";

export async function getArtistData(query: string): Promise<any> {
  if (!query) return null;
  const url = `https://api.musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.artists?.length) return null;

  const artist = data.artists[0];
  return {
    artistName: artist.name,
    artistId: artist.id,
    overview: artist.disambiguation ?? "Imported from MusicBrainz",
    Albums: [], // MB liefert keine vollständigen Alben direkt – ggf. ergänzbar
  };
}
