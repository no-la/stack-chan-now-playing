import assert from "node:assert/strict";
import test from "node:test";
import { toSpotifyPlayback } from "../src/local-spotify.ts";

test("maps the Mac Spotify scripting response to the Web API shape", () => {
  assert.deepEqual(toSpotifyPlayback({
    available: true,
    state: "playing",
    position: 12.5,
    name: "Digital Love",
    artist: "Daft Punk",
    album: "Discovery",
    duration: 301_800,
    artworkUrl: "https://i.scdn.co/image/example",
  }), {
    is_playing: true,
    progress_ms: 12_500,
    item: {
      name: "Digital Love",
      duration_ms: 301_800,
      artists: [{ name: "Daft Punk" }],
      album: {
        name: "Discovery",
        images: [{ url: "https://i.scdn.co/image/example", width: 640 }],
      },
    },
  });
});
