import assert from "node:assert/strict";
import test from "node:test";
import { toPlayerState } from "../src/player.ts";

test("maps Spotify playback into the firmware contract", () => {
  const result = toPlayerState({
    is_playing: true,
    progress_ms: 42_000,
    item: {
      name: "Digital Love",
      duration_ms: 301_800,
      artists: [{ name: "Daft Punk" }],
      album: {
        name: "Discovery",
        images: [
          { url: "https://i.scdn.co/large", width: 640 },
          { url: "https://i.scdn.co/medium", width: 300 },
          { url: "https://i.scdn.co/small", width: 64 },
        ],
      },
    },
  }, "http://stack-chan.local:8789");

  assert.deepEqual(result, {
    playing: true,
    track: "Digital Love",
    artist: "Daft Punk",
    album: "Discovery",
    progressMs: 42_000,
    durationMs: 301_800,
    artworkUrl: "http://stack-chan.local:8789/api/artwork?url=https%3A%2F%2Fi.scdn.co%2Flarge",
    artworkWidth: 640,
  });
});

test("uses safe defaults while nothing is playing", () => {
  assert.deepEqual(toPlayerState(null, "http://localhost:8789"), {
    playing: false,
    track: "",
    artist: "",
    album: "",
    progressMs: 0,
    durationMs: 0,
    artworkUrl: null,
    artworkWidth: 0,
  });
});
