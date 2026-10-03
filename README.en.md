# stack-chan-now-playing

[日本語](README.md)

A self-hosted Spotify now-playing display and remote control for M5Stack
CoreS3. It shows album artwork, playback state, and progress, and provides
touch controls for previous, play/pause, and next.

This is an experimental project intended for personal, non-commercial use. It
is not affiliated with, endorsed by, or sponsored by Spotify. Spotify is a
trademark of Spotify AB.
Users are responsible for reviewing and complying with the
[Spotify Developer Terms](https://developer.spotify.com/terms),
[Developer Policy](https://developer.spotify.com/policy), and
[Design Guidelines](https://developer.spotify.com/documentation/design) for
their own use.

## Architecture

```text
Spotify Web API ---------------------> server/ <-> firmware/ (CoreS3)
                                         ^
macOS Spotify app --AppleScript---------+
```

The CoreS3 receives only a small JSON representation of the player state over
the local network. Spotify credentials and refresh tokens remain on the
self-hosted server.

## Spotify backends

Select a backend with `SPOTIFY_BACKEND` in `.env`:

- `auto`: prefer the local macOS app and fall back to the Web API
- `macos`: read and control the local macOS Spotify app through AppleScript
- `web-api`: use only the cross-platform Spotify Web API

Web API state requests are limited to one every 30 seconds by default. Cached
state is returned between requests. Playback commands are sent immediately.

## Server

Requirement: Node.js 24 or newer.

### macOS-only setup

1. Install and open the Spotify desktop app for macOS.
2. Copy `.env.example` to `.env`.
3. Set `SPOTIFY_BACKEND=macos`.
4. Run `npm run server`.

macOS may request Automation permission the first time the server accesses
Spotify. A Spotify Developer App and OAuth are not required in this mode.
This is an unofficial, experimental backend that uses the desktop app's
AppleScript interface instead of the Spotify Web API.

### Web API setup

1. Create your own app in the Spotify Developer Dashboard.
2. Register `http://127.0.0.1:8789/auth/callback` as a redirect URI.
3. Copy `.env.example` to `.env` and add the Client ID and Client Secret.
4. Select `SPOTIFY_BACKEND=web-api` or `auto`.
5. Run `npm run server`.
6. Open <http://127.0.0.1:8789/auth/login> once to authorize Spotify.

Each self-hosted installation is expected to use its own Spotify Developer App.
This project does not distribute shared client credentials. Spotify Premium is
required for Web API playback control.

### HTTP API

```text
GET  /health
GET  /api/player
POST /api/player/play-pause
POST /api/player/next
POST /api/player/previous
```

Run checks with `npm test` and `npm run check`.

Stop the server and run `npm run spotify:disconnect` to delete locally stored
OAuth tokens. See [PRIVACY.md](PRIVACY.md) for data-handling details.

## CoreS3 firmware

1. Copy `firmware/include/config.example.h` to `firmware/include/config.h` and
   set the default server URL on your LAN.
2. Connect the CoreS3 and identify its serial port.
3. Build and upload with PlatformIO:

```sh
cd firmware
pio run -e m5stack-cores3
pio run -e m5stack-cores3 -t upload --upload-port /dev/cu.usbmodemXXXX
```

On first boot, connect a phone or Mac to `stack-chan-setup` with password
`stackchan`, then open <http://192.168.4.1>. Enter the home Wi-Fi credentials
and server URL. The settings are stored in ESP32 NVS and do not enter the
source tree. Hold the CoreS3 screen during power-on to erase saved settings.

## Controls

- Tap the left side: previous track
- Tap the center: play/pause
- Tap the right side: next track
- Tap the Spotify icon at the upper left: show a QR code that opens the current
  track in Spotify
- Tap anywhere while the QR code is visible: return to the player

The player shows the square album artwork, playback state, progress, and
Spotify attribution. The icon is the official asset resized to 24px.

## Notes

- Intended for personal, non-commercial, self-hosted use.
- It does not download, store, or redistribute Spotify audio.
- Spotify app or Web API changes may break the integration.
- Never commit the Client Secret, OAuth tokens, or `.env`.
- This project has not been certified for compliance by Spotify.

## License and security

Source code is available under the [MIT License](LICENSE). The Spotify logo is
excluded from that license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
See [SECURITY.md](SECURITY.md) for vulnerability reporting and self-hosting
security guidance.
