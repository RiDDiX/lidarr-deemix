import fetch from "node-fetch";

const DEEZER_API = "https://api.deezer.com";

export async function deemixSearch(query: string): Promise<any[]> {
  if (!query) return [];

  const res = await fetch(`${DEEZER_API}/search/artist?q=${encodeURIComponent(query)}`);
  const json = await res.json();
  if (!json.data?.length) return [];

  return json.data.map((artist: any) => ({
    artistName: artist.name,
    artistId: `deemix-aaaa-${artist.id}`,
    overview: "Imported from Deezer",
    links: [{ name: "Deezer", url: artist.link }],
  }));
}

export async function getArtist(query: string): Promise<any> {
  if (!query) return null;
  const id = query.replace("deemix-aaaa-", "");
  const res = await fetch(`${DEEZER_API}/artist/${id}`);
  const artist = await res.json();

  const albumsRes = await fetch(`${DEEZER_API}/artist/${id}/albums`);
  const albumsJson = await albumsRes.json();

  return {
    artistName: artist.name,
    artistId: `deemix-aaaa-${artist.id}`,
    overview: "Imported from Deezer",
    albums: albumsJson.data.map((a: any) => ({
      albumId: `deemix-bbbb-${a.id}`,
      title: a.title,
      releaseDate: a.release_date,
      coverUrl: a.cover_medium,
    })),
  };
}

export async function getAlbum(query: string): Promise<any> {
  if (!query) return null;
  const id = query.replace("deemix-bbbb-", "");
  const res = await fetch(`${DEEZER_API}/album/${id}`);
  const album = await res.json();

  return {
    title: album.title,
    releaseDate: album.release_date,
    artist: {
      name: album.artist?.name,
      id: album.artist?.id,
    },
    tracks: album.tracks?.data?.map((t: any) => ({
      title: t.title,
      duration: t.duration,
    })) ?? [],
  };
}
