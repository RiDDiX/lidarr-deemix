import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase, mergeAlbumLists } from "./helpers.js";
import { getArtistData, findPlaceholderArtist } from "./artistData.js";
import { getAllLidarrArtists } from "./lidarr.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

async function safeDeemixFetch(path: string) {
    try {
        const res = await fetch(`${deemixUrl}${path}`);
        if (!res.ok) {
            console.warn(`Deemix-Server antwortete mit Fehler ${res.status} für Pfad: ${path}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`Fehler bei der Verbindung zum Deemix-Server für Pfad: ${path}`, e);
        return null;
    }
}

function createFakeMbid(deemixId: number | string): string {
    const hexId = Number(deemixId).toString(16).padStart(12, '0');
    const fakeUuid = `deee${hexId}deee${hexId}deee${hexId}`.slice(0, 32);
    return `${fakeUuid.slice(0, 8)}-${fakeUuid.slice(8, 12)}-${fakeUuid.slice(12, 16)}-${fakeUuid.slice(16, 20)}-${fakeUuid.slice(20, 32)}`;
}

export async function deemixArtists(name: string): Promise<any[]> {
  const json = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  return json?.data || [];
}

export async function deemixAlbum(id: string): Promise<any> {
  return await safeDeemixFetch(`/albums/${id}`);
}

export async function deemixAlbums(name: string): Promise<any[]> {
  const data = await safeDeemixFetch(`/search/albums?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  const albums = data?.data || [];
  return albums
    .filter((a: any) => normalize(a?.artist?.name || "") === normalize(name))
    .map((d: any) => ({
      Id: createFakeMbid(d.id),
      ReleaseStatuses: ["Official"],
      SecondaryTypes: d.title.toLowerCase().includes("live") ? ["Live"] : [],
      Title: titleCase(d.title),
      LowerTitle: normalize(d.title),
      Type: d.record_type === 'ep' ? 'EP' : titleCase(d.record_type || 'album'),
  }));
}

export async function search(lidarr: any[], query: string): Promise<any[]> {
  const deemixArtistsList = await deemixArtists(query);
  const existingMbids = new Set(lidarr.map(item => item?.artist?.foreignArtistId));
  const deemixResults = [];

  for (const dArtist of deemixArtistsList) {
    const mbArtist = await getArtistData(dArtist.name);

    if (mbArtist && !existingMbids.has(mbArtist.foreignArtistId)) {
      // Künstler existiert auf MB und Deemix, perfekt!
      deemixResults.push({
        artist: {
          ...mbArtist,
          images: [{ CoverType: "Poster", Url: dArtist.picture_xl }], // Besseres Bild von Deemix
        },
      });
      existingMbids.add(mbArtist.foreignArtistId);
    } else if (!mbArtist) {
      // Künstler existiert NUR auf Deemix, hier kommt der Trick!
      const placeholder = await findPlaceholderArtist(); // Finde einen Platzhalter
      if (placeholder) {
        deemixResults.push({
          artist: {
            ...placeholder, // Nutze die GÜLTIGE ID vom Platzhalter
            artistname: dArtist.name, // ABER den Namen von Deemix
            sortname: dArtist.name.split(" ").reverse().join(", "),
            overview: `Importiert von Deemix. Echte Deemix ID: ${dArtist.id}`,
            images: [{ CoverType: "Poster", Url: dArtist.picture_xl }],
            // Wichtig: Wir speichern die Deemix ID im ForeignArtistId,
            // damit wir ihn später wiedererkennen
            foreignArtistId: `deez${dArtist.id}`,
          },
        });
      }
    }
  }

  return [...lidarr, ...deemixResults];
}

export async function getFullArtist(mbid: string, foreignArtistId?: string): Promise<any> {
    if (foreignArtistId?.startsWith('deez')) {
        // Dies ist ein Deemix-Künstler, der eine MBID "geborgt" hat.
        // Wir ignorieren die MBID und holen alles frisch von Deemix.
        const deemixId = foreignArtistId.replace('deez', '');
        const j = await safeDeemixFetch(`/artists/${deemixId}`);
        if (!j) return null;

        const albums = (j.albums?.data || []).map((a: any) => ({
             Id: createFakeMbid(a.id),
             Title: titleCase(a.title),
             //... weitere Albumfelder
        }));

        return {
            id: mbid, // Gib die "geliehene" MBID zurück
            foreignArtistId: `deez${deemixId}`,
            artistname: j.name,
            sortname: j.name.split(" ").reverse().join(", "),
            images: [{ CoverType: "Poster", Url: j.picture_xl }],
            overview: `Importiert von Deemix. Echte Deemix ID: ${deemixId}`,
            Albums: albums,
            //... fülle alle anderen von Lidarr benötigten Felder
        };
    } else {
        // Dies ist ein normaler MusicBrainz-Künstler, wir reichern ihn an.
        const mbArtist = await getArtistData(mbid);
        if (mbArtist) {
            const albumsFromDeemix = await deemixAlbums(mbArtist.artistname);
            mbArtist.Albums = mergeAlbumLists(mbArtist.Albums, albumsFromDeemix);
        }
        return mbArtist;
    }
}