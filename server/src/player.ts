export type PlayerState = {
  playing: boolean;
  track: string;
  artist: string;
  album: string;
  progressMs: number;
  durationMs: number;
  artworkUrl: string | null;
  artworkWidth: number;
};

type SpotifyImage = { url?: unknown; width?: unknown };

export function toPlayerState(value: unknown, baseUrl: string): PlayerState {
  const body = asRecord(value);
  const item = asRecord(body.item);
  const album = asRecord(item.album);
  const artists = Array.isArray(item.artists) ? item.artists : [];
  const images = Array.isArray(album.images) ? (album.images as SpotifyImage[]) : [];
  const artwork = selectArtwork(images);

  return {
    playing: body.is_playing === true,
    track: stringValue(item.name),
    artist: artists
      .map((artist) => stringValue(asRecord(artist).name))
      .filter(Boolean)
      .join(", "),
    album: stringValue(album.name),
    progressMs: Math.round(nonNegativeNumber(body.progress_ms)),
    durationMs: Math.round(nonNegativeNumber(item.duration_ms)),
    artworkUrl: artwork
      ? `${baseUrl}/api/artwork?url=${encodeURIComponent(artwork.url)}`
      : null,
    artworkWidth: artwork?.width ?? 0,
  };
}

function selectArtwork(images: SpotifyImage[]): { url: string; width: number } | null {
  const valid = images
    .filter((image): image is { url: string; width: number } =>
      typeof image.url === "string" &&
      image.url.startsWith("https://") &&
      typeof image.width === "number" &&
      Number.isFinite(image.width) &&
      image.width > 0,
    )
    .sort((a, b) => a.width - b.width);

  // Keep the source width so the CoreS3 can scale rather than clip the JPEG.
  return valid.at(-1) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegativeNumber(value: unknown): number {
  return Math.max(0, numberValue(value));
}
