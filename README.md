# stack-chan-spotify

A self-hosted Spotify now-playing display and remote control for M5Stack
CoreS3. It works cross-platform through the Spotify Web API and can optionally
use the local Spotify app on macOS for faster updates without consuming API
quota.

## Architecture

```text
Spotify Web API ---------------------> server/ <-> firmware/ (CoreS3)
                                         ^
macOS Spotify app --AppleScript---------+
```

Spotify credentials and refresh tokens stay on the self-hosted server. The
firmware receives only a small JSON representation of the current player
state. Web API state requests are limited to one every 30 seconds by default;
responses between requests come from the server cache.

## Server

Requirements: Node.js 24 or newer.

1. Create an app in the Spotify Developer Dashboard. Each self-hosted
   installation should use its own app credentials.
2. Add `http://127.0.0.1:8789/auth/callback` as a redirect URI.
3. Copy `.env.example` to `.env` and enter the client ID and secret.
4. Choose a backend with `SPOTIFY_BACKEND`:

   - `web-api`: cross-platform Spotify Web API only
   - `macos`: local macOS Spotify app only
   - `auto`: try the macOS app first, then fall back to the Web API

5. Start the server:

   ```sh
   npm run server
   ```

6. Open <http://127.0.0.1:8789/auth/login> once and authorize Spotify. This is
   not required when using the `macos` backend.

On macOS, install and open the Spotify desktop app before using the `macos` or
`auto` backend. macOS may ask for Automation access the first time the server
reads or controls it.

Useful endpoints:

```text
GET  /health
GET  /api/player
POST /api/player/play-pause
POST /api/player/next
POST /api/player/previous
```

Run the tests with `npm test`.

## Firmware

1. Copy `firmware/include/config.example.h` to `firmware/include/config.h` and
   set the default server LAN address.
2. Connect the CoreS3 and identify its port with `ls /dev/cu.usbmodem*`.
3. Build and upload:

   ```sh
   cd firmware
   pio run -e m5stack-cores3
   pio run -e m5stack-cores3 -t upload --upload-port /dev/cu.usbmodemXXXX
   ```

On first boot, connect a phone or Mac to `stack-chan-setup` using password
`stackchan`, then open <http://192.168.4.1>. Enter the home Wi-Fi credentials
and server URL. They are saved in the ESP32's NVS and do not enter the source
tree. If connection fails, setup mode starts again. To erase saved settings,
hold the CoreS3 screen while powering it on.

The firmware displays contained album artwork, playback state and a progress
bar. Tap the left, center or right area for previous, play/pause or next.
