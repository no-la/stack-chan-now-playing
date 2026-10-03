import { createServer, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { localCommand, localCurrentlyPlaying } from "./local-spotify.ts";
import { SpotifyApiError, SpotifyClient } from "./spotify.ts";
import { toPlayerState } from "./player.ts";

const host = process.env.STACK_CHAN_HOST ?? "0.0.0.0";
const port = Number(process.env.STACK_CHAN_PORT ?? "8789");
const publicBaseUrl = process.env.STACK_CHAN_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const spotifyBackend = parseBackend(process.env.SPOTIFY_BACKEND ?? "auto");
const spotify = new SpotifyClient(
  process.env.SPOTIFY_CLIENT_ID ?? "",
  process.env.SPOTIFY_CLIENT_SECRET ?? "",
  process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${port}/auth/callback`,
  new URL("../data/spotify-tokens.json", import.meta.url).pathname,
);
let oauthState = "";
const webFallbackIntervalMs = Number(process.env.SPOTIFY_WEB_FALLBACK_INTERVAL_MS ?? "30000");
let lastWebRequestAt = 0;
let webBlockedUntil = 0;
let cachedPlayback: unknown = null;
let hasCachedPlayback = false;
let cachedAt = 0;
let fallbackError: ApiError | null = null;

type ApiError = { code: string; message: string };

const server = createServer(async (request, response) => {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", publicBaseUrl);
    console.log(`${method} ${url.pathname} from ${request.socket.remoteAddress ?? "unknown"}`);

    if (method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        spotifyBackend,
        spotifyConfigured: spotify.configured,
      });
    }

    if (method === "GET" && url.pathname === "/auth/login") {
      if (!spotify.configured) return json(response, 503, { error: "Spotify credentials are not configured" });
      oauthState = randomBytes(24).toString("hex");
      response.writeHead(302, { location: spotify.authorizationUrl(oauthState) });
      return response.end();
    }

    if (method === "GET" && url.pathname === "/auth/callback") {
      if (!oauthState || url.searchParams.get("state") !== oauthState) {
        return json(response, 400, { error: "Invalid OAuth state" });
      }
      const code = url.searchParams.get("code");
      if (!code) return json(response, 400, { error: "Missing authorization code" });
      oauthState = "";
      await spotify.exchangeCode(code);
      return html(response, 200, "<h1>stack-chan is connected to Spotify.</h1><p>You can close this tab.</p>");
    }

    if (method === "GET" && url.pathname === "/api/player") {
      const requestBaseUrl = process.env.STACK_CHAN_PUBLIC_URL
        ?? `http://${request.headers.host ?? `127.0.0.1:${port}`}`;
      const result = await resolvePlayback();
      if (!result.available) {
        return json(response, 503, { error: result.error });
      }
      return json(response, 200, {
        ...toPlayerState(result.playback, requestBaseUrl),
        source: result.source,
        updatedAt: new Date(result.updatedAt).toISOString(),
        error: result.error,
      });
    }

    const command = url.pathname.match(/^\/api\/player\/(play-pause|next|previous)$/)?.[1];
    if (method === "POST" && command) {
      const playerCommand = command as "play-pause" | "next" | "previous";
      await sendPlayerCommand(playerCommand);
      response.writeHead(204);
      return response.end();
    }

    if (method === "GET" && url.pathname === "/api/artwork") {
      const source = url.searchParams.get("url");
      if (!source || !source.startsWith("https://i.scdn.co/")) {
        return json(response, 400, { error: "Invalid artwork URL" });
      }
      const artwork = await fetch(source);
      if (!artwork.ok) return json(response, 502, { error: "Artwork fetch failed" });
      const image = Buffer.from(await artwork.arrayBuffer());
      response.writeHead(artwork.status, {
        "content-type": artwork.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "public, max-age=86400",
        "content-length": image.byteLength,
      });
      return response.end(image);
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    if (error instanceof SpotifyApiError) {
      return json(response, error.status, {
        error: { code: error.reason, message: error.message },
      });
    }
    return json(response, 500, { error: error instanceof Error ? error.message : "Internal error" });
  }
});

async function resolvePlayback(): Promise<
  | { available: true; playback: unknown; source: "local" | "web-api" | "cache"; updatedAt: number; error: ApiError | null }
  | { available: false; error: ApiError }
> {
  let localError: unknown = null;
  if (spotifyBackend !== "web-api") {
    try {
      const playback = await localCurrentlyPlaying();
      cachedPlayback = playback;
      hasCachedPlayback = true;
      cachedAt = Date.now();
      fallbackError = null;
      return { available: true, playback, source: "local", updatedAt: cachedAt, error: null };
    } catch (error) {
      localError = error;
    }
  }

  const now = Date.now();
  if (spotifyBackend !== "macos" && spotify.configured && now >= webBlockedUntil && now - lastWebRequestAt >= webFallbackIntervalMs) {
      lastWebRequestAt = now;
      try {
        cachedPlayback = await spotify.currentlyPlaying();
        hasCachedPlayback = true;
        cachedAt = now;
        fallbackError = null;
        return { available: true, playback: cachedPlayback, source: "web-api", updatedAt: cachedAt, error: null };
      } catch (error) {
        fallbackError = apiError(error);
        if (error instanceof SpotifyApiError && error.status === 429) {
          const waitMs = error.reason === "QUOTA_EXCEEDED"
            ? 60 * 60 * 1000
            : (error.retryAfterSeconds ?? 30) * 1000;
          webBlockedUntil = now + waitMs;
        }
      }
  }

  const error = fallbackError ?? (spotifyBackend === "web-api"
    ? { code: "SPOTIFY_NOT_CONFIGURED", message: "Spotify Web API credentials are not configured" }
    : {
        code: "LOCAL_SPOTIFY_UNAVAILABLE",
        message: localError instanceof Error ? localError.message : "Mac Spotify is unavailable",
      });
  if (hasCachedPlayback) {
    return { available: true, playback: cachedPlayback, source: "cache", updatedAt: cachedAt, error };
  }
  return { available: false, error };
}

async function sendPlayerCommand(command: "play-pause" | "next" | "previous"): Promise<void> {
  if (spotifyBackend === "macos") return localCommand(command);
  if (spotifyBackend === "web-api") return spotify.command(command);
  try {
    await localCommand(command);
  } catch {
    await spotify.command(command);
  }
}

type SpotifyBackend = "auto" | "web-api" | "macos";

function parseBackend(value: string): SpotifyBackend {
  if (value === "auto" || value === "web-api" || value === "macos") return value;
  throw new Error(`Invalid SPOTIFY_BACKEND: ${value}`);
}

function apiError(error: unknown): ApiError {
  if (error instanceof SpotifyApiError) {
    return { code: error.reason, message: error.message };
  }
  return {
    code: "SPOTIFY_WEB_API_ERROR",
    message: error instanceof Error ? error.message : "Spotify Web API failed",
  };
}

server.listen(port, host, () => {
  console.log(`stack-chan-spotify server listening on http://${host}:${port}`);
  console.log(`Spotify backend: ${spotifyBackend}`);
  console.log(`Spotify authorization: ${publicBaseUrl}/auth/login`);
});

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function html(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(value);
}
