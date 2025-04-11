export interface ArtistData {
  id: number;
  name: string;
  albums: any[];      // Hier kannst du den Typ noch genauer definieren
  images?: any[];     // Optionales Feld für Bilder
}

export function getArtistData(name: string): ArtistData {
  return {
    id: 1,
    name: name,
    albums: [],
  };
}
