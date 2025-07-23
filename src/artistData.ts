export interface ArtistData {
  id: number;
  name: string;
  albums: any[];
  images?: any[];
}

export function getArtistData(name: string): ArtistData {
  return {
    id: 1,
    name: name,
    albums: [],
  };
}