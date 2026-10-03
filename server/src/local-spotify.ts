import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const fieldSeparator = "\u001f";
const stateScript = String.raw`
set AppleScript's text item delimiters to ASCII character 31
tell application "Spotify"
  if not running then return "NOT_RUNNING"
  set currentSpotifyTrack to current track
  return {player state as text, player position as text, (name of currentSpotifyTrack) as text, (artist of currentSpotifyTrack) as text, (album of currentSpotifyTrack) as text, duration of currentSpotifyTrack as text, (artwork url of currentSpotifyTrack) as text} as text
end tell
`;

type LocalState = {
  available?: unknown;
  state?: unknown;
  position?: unknown;
  name?: unknown;
  artist?: unknown;
  album?: unknown;
  duration?: unknown;
  artworkUrl?: unknown;
};

export class LocalSpotifyUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalSpotifyUnavailableError";
  }
}

export async function localCurrentlyPlaying(): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("/usr/bin/osascript", ["-e", stateScript], {
      timeout: 4_000,
      maxBuffer: 64 * 1024,
    }));
  } catch (error) {
    throw new LocalSpotifyUnavailableError("Mac Spotify state is unavailable", { cause: error });
  }

  if (stdout.trim() === "NOT_RUNNING") {
    throw new LocalSpotifyUnavailableError("Mac Spotify is not running");
  }
  const fields = stdout.trimEnd().split(fieldSeparator);
  if (fields.length !== 7) {
    throw new LocalSpotifyUnavailableError("Mac Spotify returned an invalid state");
  }
  const state: LocalState = {
    available: true,
    state: fields[0],
    position: Number(fields[1]),
    name: fields[2],
    artist: fields[3],
    album: fields[4],
    duration: Number(fields[5]),
    artworkUrl: fields[6],
  };
  return toSpotifyPlayback(state);
}

export async function localCommand(command: "play-pause" | "next" | "previous"): Promise<void> {
  const commandName = {
    "play-pause": "playpause",
    next: "next track",
    previous: "previous track",
  }[command];
  const script = `tell application "Spotify"\nif not running then error "Spotify is not running"\n${commandName}\nend tell`;
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: 4_000,
      maxBuffer: 16 * 1024,
    });
  } catch (error) {
    throw new LocalSpotifyUnavailableError("Mac Spotify command failed", { cause: error });
  }
}

export function toSpotifyPlayback(state: LocalState): unknown {
  const artworkUrl = stringValue(state.artworkUrl);
  return {
    is_playing: state.state === "playing",
    progress_ms: Math.max(0, numberValue(state.position) * 1000),
    item: {
      name: stringValue(state.name),
      duration_ms: Math.max(0, numberValue(state.duration)),
      artists: [{ name: stringValue(state.artist) }],
      album: {
        name: stringValue(state.album),
        images: artworkUrl.startsWith("https://")
          ? [{ url: artworkUrl, width: 640 }]
          : [],
      },
    },
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
