import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const SPOTIFY_API = "https://api.spotify.com/v1";

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class SpotifyClient {
  #tokens: StoredTokens | null = null;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  readonly #tokenFile: string;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    tokenFile: string,
  ) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#redirectUri = redirectUri;
    this.#tokenFile = tokenFile;
  }

  get configured(): boolean {
    return Boolean(this.#clientId && this.#clientSecret && this.#redirectUri);
  }

  authorizationUrl(state: string): string {
    const url = new URL(`${SPOTIFY_ACCOUNTS}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.#clientId,
      response_type: "code",
      redirect_uri: this.#redirectUri,
      scope: [
        "user-read-currently-playing",
        "user-read-playback-state",
        "user-modify-playback-state",
      ].join(" "),
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<void> {
    const tokens = await this.#requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.#redirectUri,
    });
    await this.#save(tokens);
  }

  async currentlyPlaying(): Promise<unknown | null> {
    const response = await this.#api("/me/player/currently-playing");
    if (response.status === 204) return null;
    await assertOk(response);
    return response.json();
  }

  async command(command: "play-pause" | "next" | "previous"): Promise<void> {
    if (command === "play-pause") {
      const state = await this.currentlyPlaying();
      const playing = isRecord(state) && state.is_playing === true;
      const response = await this.#api(playing ? "/me/player/pause" : "/me/player/play", {
        method: "PUT",
      });
      await assertOk(response);
      return;
    }

    const response = await this.#api(`/me/player/${command}`, { method: "POST" });
    await assertOk(response);
  }

  async #api(path: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await this.#accessToken();
    return fetch(`${SPOTIFY_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
  }

  async #accessToken(): Promise<string> {
    this.#tokens ??= await this.#load();
    if (!this.#tokens) throw new Error("Spotify is not authorized. Open /auth/login first.");

    if (Date.now() < this.#tokens.expiresAt - 60_000) {
      return this.#tokens.accessToken;
    }

    const refreshed = await this.#requestToken({
      grant_type: "refresh_token",
      refresh_token: this.#tokens.refreshToken,
    });
    await this.#save({
      ...refreshed,
      refreshToken: refreshed.refreshToken || this.#tokens.refreshToken,
    });
    return this.#tokens!.accessToken;
  }

  async #requestToken(params: Record<string, string>): Promise<StoredTokens> {
    const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
    await assertOk(response);
    const body = (await response.json()) as Record<string, unknown>;
    return {
      accessToken: String(body.access_token ?? ""),
      refreshToken: String(body.refresh_token ?? ""),
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    };
  }

  async #load(): Promise<StoredTokens | null> {
    try {
      return JSON.parse(await readFile(this.#tokenFile, "utf8")) as StoredTokens;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async #save(tokens: StoredTokens): Promise<void> {
    this.#tokens = tokens;
    await mkdir(dirname(this.#tokenFile), { recursive: true });
    await writeFile(this.#tokenFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  }
}

export class SpotifyApiError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    reason: string,
    retryAfterSeconds: number | null,
    message: string,
  ) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const message = await response.text();
  let reason = "SPOTIFY_API_ERROR";
  try {
    const body = JSON.parse(message) as { error?: { reason?: unknown } };
    if (typeof body.error?.reason === "string") reason = body.error.reason;
  } catch {
    // Keep the generic reason for non-JSON responses.
  }
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  throw new SpotifyApiError(
    response.status,
    reason,
    Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
    `Spotify API ${response.status}: ${message}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
