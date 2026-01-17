// types.ts - Lidarr API Type Definitions

// ============================================================================
// ID System
// ============================================================================

export type DeemixEntityType = "artist" | "album" | "track" | "release" | "recording";

// Prefix für Fake-IDs um Deezer von MusicBrainz zu unterscheiden
export const DEEMIX_ID_PREFIX = "deemix-";

// ============================================================================
// Lidarr API Types - Search Response
// ============================================================================

export interface LidarrSearchResult {
  score?: number;
  artist: LidarrArtist | null;
  album: LidarrAlbumBasic | null;
}

// ============================================================================
// Lidarr API Types - Artist
// ============================================================================

export interface LidarrArtist {
  id: string;
  artistname: string;
  sortname: string;
  artistaliases: string[];
  disambiguation: string;
  overview: string | null;
  links: LidarrLink[];
  images: LidarrImage[];
  rating: LidarrRating;
  status: string;
  genres: string[];
  type: string;
  Albums: LidarrAlbumBasic[];
  oldids: string[];
}

export interface LidarrLink {
  target: string;
  type: string;
}

export interface LidarrImage {
  CoverType: "Poster" | "Cover" | "Fanart" | "Banner" | "Logo" | "Disc";
  Url: string;
  remoteUrl?: string;
}

export interface LidarrRating {
  Count: number;
  Value: number | null;
}

// ============================================================================
// Lidarr API Types - Album (Basic, in Artist.Albums)
// ============================================================================

export interface LidarrAlbumBasic {
  Id: string;
  OldIds: string[];
  Title: string;
  Type: "Album" | "Single" | "EP" | "Broadcast" | "Other";
  SecondaryTypes: string[];
  ReleaseStatuses: string[];
  ReleaseDate?: string | null;
  Rating?: LidarrRating | null;
}

// ============================================================================
// Lidarr API Types - Album (Full, from /album/{id})
// ============================================================================

export interface LidarrAlbumFull {
  id: string;
  oldids: string[];
  disambiguation: string;
  title: string;
  aliases: string[];
  type: string;
  secondarytypes: string[];
  releasedate: string | null;
  artistid: string;
  rating: LidarrRating;
  links: LidarrLink[];
  genres: string[];
  images: LidarrImage[];
  overview: string | null;
  releases: LidarrRelease[];
  artists: LidarrArtistCredit[];
}

export interface LidarrArtistCredit {
  id: string;
  artistname: string;
  artistaliases: string[];
  disambiguation: string;
  overview: string | null;
  genres: string[];
  images: LidarrImage[];
  links: LidarrLink[];
  oldids: string[];
  sortname: string;
  status: string;
  type: string;
}

export interface LidarrRelease {
  Id: string;
  OldIds: string[];
  Title: string;
  Status: string;
  Disambiguation: string;
  Country: string[];
  Label: string[];
  Media: LidarrMedia[];
  ReleaseDate: string | null;
  TrackCount: number;
  Tracks: LidarrTrack[];
}

export interface LidarrMedia {
  Position: number;
  Name: string;
  Format: string;
}

export interface LidarrTrack {
  Id: string;
  OldIds: string[];
  ArtistId: string;
  RecordingId: string;
  OldRecordingIds: string[];
  TrackName: string;
  TrackNumber: string;
  TrackPosition: number;
  DurationMs: number;
  MediumNumber: number;
  ArtistCredit?: LidarrArtistCredit[];
}

// ============================================================================
// Deezer API Types (from deemix-server)
// ============================================================================

export interface DeezerArtist {
  id: number;
  name: string;
  link: string;
  picture: string;
  picture_small: string;
  picture_medium: string;
  picture_big: string;
  picture_xl: string;
  nb_album?: number;
  nb_fan?: number;
  type: string;
}

export interface DeezerAlbum {
  id: number;
  title: string;
  link: string;
  cover: string;
  cover_small: string;
  cover_medium: string;
  cover_big: string;
  cover_xl: string;
  genre_id?: number;
  nb_tracks?: number;
  release_date?: string;
  record_type: string;
  explicit_lyrics?: boolean;
  artist: DeezerArtist;
  type: string;
  label?: string;
  contributors?: DeezerArtist[];
  tracks?: { data: DeezerTrack[] };
}

export interface DeezerTrack {
  id: number;
  title: string;
  title_short: string;
  duration: number;
  track_position: number;
  disk_number: number;
  rank?: number;
  explicit_lyrics?: boolean;
  preview?: string;
  artist: DeezerArtist;
  type: string;
}

export interface DeezerSearchResponse<T> {
  data: T[];
  total: number;
  next?: string;
}

export interface DeezerArtistFull extends DeezerArtist {
  albums?: { data: DeezerAlbum[] };
  top?: { data: DeezerTrack[] };
}
