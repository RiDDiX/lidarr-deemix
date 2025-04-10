// In deemix.ts, Funktion search:
export async function search(lidarr: any, query: string, isManual: boolean = true): Promise<any> {
  // Falls lidarr undefined oder nicht ein Array ist, initialisiere es als leeres Array.
  if (!Array.isArray(lidarr)) {
    lidarr = [];
  }
  const dartists = await deemixArtists(query);
  let lartist: any;
  let lidx = -1;
  let didx = -1;
  if (process.env.OVERRIDE_MB !== "true") {
    for (const [i, artist] of lidarr.entries()) {
      if (artist["album"] === null) {
        lartist = artist;
        lidx = i;
        break;
      }
    }
  }
  if (lartist) {
    let dartist: any;
    for (const [i, d] of dartists.entries()) {
      if (
        lartist["artist"]["artistname"] === d["name"] ||
        normalize(lartist["artist"]["artistname"]) === normalize(d["name"])
      ) {
        dartist = d;
        didx = i;
        break;
      }
    }
    if (dartist) {
      let posterFound = false;
      for (const img of lartist["artist"]["images"] as any[]) {
        if (img["CoverType"] === "Poster") {
          posterFound = true;
          break;
        }
      }
      if (!posterFound) {
        (lartist["artist"]["images"] as any[]).push({
          CoverType: "Poster",
          Url: dartist["picture_xl"],
        });
      }
      lartist["artist"]["oldids"].push(fakeId(dartist["id"], "artist"));
    }
    lidarr[lidx] = lartist;
  }
  if (didx > -1) {
    dartists.splice(didx, 1);
  }
  let dtolartists: any[] = dartists.map((d: any) => ({
    artist: {
      artistaliases: [],
      artistname: d["name"],
      sortname: (d["name"] as string).split(" ").reverse().join(", "),
      genres: [],
      id: fakeId(d["id"], "artist"),
      images: [{ CoverType: "Poster", Url: d["picture_xl"] }],
      links: [{
        target: d["link"],
        type: "deezer",
      }],
      type: (d["type"] as string).charAt(0).toUpperCase() + (d["type"] as string).slice(1),
    },
  }));
  if (lidarr.length === 0) {
    const sorted: any[] = [];
    for (const a of dtolartists) {
      if (
        a.artist.artistname === decodeURIComponent(query) ||
        normalize(a.artist.artistname) === normalize(decodeURIComponent(query))
      ) {
        sorted.unshift(a);
      } else {
        sorted.push(a);
      }
    }
    dtolartists = sorted;
  }
  if (!isManual) {
    dtolartists = dtolartists.map((a) => a.artist);
    if (process.env.OVERRIDE_MB === "true") {
      dtolartists = [
        dtolartists.filter((a) => {
          return (
            a["artistname"] === decodeURIComponent(query) ||
            normalize(a["artistname"]) === normalize(decodeURIComponent(query))
          );
        })[0],
      ];
    }
  }
  lidarr = [...lidarr, ...dtolartists];
  if (process.env.OVERRIDE_MB === "true") {
    lidarr = dtolartists;
  }
  return lidarr;
}
