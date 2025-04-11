export interface ArtistData {
  id: number;
  name: string;
  albums: any[];          // Statt string[] – hier kannst du den Typ weiter verfeinern
  images?: any[];         // Optional: Images können hinzugefügt werden
}

export function getArtistData(name: string): ArtistData {
  return {
    id: 1,
    name: name,
    albums: [],
  };
}
