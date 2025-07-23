import fetch from "node-fetch";

const deemixApi = "https://api.deezer.com";

export async function deemixSearch(query: string) {
  const url = `${deemixApi}/search/artist?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();

  return (data.data || []).map((a: any) => ({
    Id: `dz-${a.id}`,
    Name: a.name,
    Type: "artist",
    Images: [{ Url: a.picture_medium }],
    Overview: `Deezer fallback result for "${a.name}"`,
  }));
}

export async function deemixArtist(id: string) {
  const res = await fetch(`${deemixApi}/artist/${id}`);
  const data = await res.json();

  const albumsRes = await fetch(`${deemixApi}/artist/${id}/albums`);
  const albumsData = await albumsRes.json();

  return {
    Id: `dz-${data.id}`,
    Name: data.name,
    Type: "artist",
    Images: [{ Url: data.picture_medium }],
    Overview: `Imported from Deezer`,
    Albums: (albumsData.data || []).map((a: any) => ({
      Id: `dz-${a.id}`,
      Title: a.title,
      ReleaseDate: a.release_date,
      Images: [{ Url: a.cover_medium }],
    })),
  };
}

export async function deemixAlbum(id: string) {
  const res = await fetch(`${deemixApi}/album/${id}`);
  const data = await res.json();

  return {
    Id: `dz-${data.id}`,
    Title: data.title,
    ReleaseDate: data.release_date,
    Images: [{ Url: data.cover_medium }],
    Tracks: (data.tracks.data || []).map((t: any) => ({
      TrackNumber: t.track_position,
      Title: t.title,
      Duration: t.duration,
    })),
  };
}
