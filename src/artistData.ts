export interface ArtistData {
  id: number;
  name: string;
  albums: string[];
}

export function getArtistData(): ArtistData {
  return {
    id: 1,
    name: "Unknown Artist",
    albums: []
  };
}
