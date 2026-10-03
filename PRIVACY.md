# Privacy

stack-chan-now-playing is self-hosted software. The project author does not
operate a hosted service and does not receive data from your installation.

## Data used

When the Spotify Web API backend is enabled, the server requests permission to
read the current playback state and control playback. It processes the current
track title, artist, album, playback position, playback state, and artwork URL.
It also stores Spotify OAuth access and refresh tokens locally in
`server/data/spotify-tokens.json` with owner-only file permissions.

When the macOS backend is enabled, the server reads the same playback metadata
from the local Spotify desktop app through AppleScript. It does not require or
store Spotify OAuth tokens in this mode.

Playback metadata and downloaded artwork are held in memory while the server is
running. This project does not intentionally persist listening history or
artwork.

## Network access

Depending on the selected backend, the server connects to Spotify's account
and Web API services and to Spotify's artwork CDN. The CoreS3 connects only to
the self-hosted server URL configured by its owner.

## Disconnecting and deleting data

Stop the server and run:

```sh
npm run spotify:disconnect
```

This deletes the locally stored OAuth token file. You may also revoke the app's
access from your Spotify account settings and delete the Spotify Developer app
from your own dashboard.

## Operator responsibility

Anyone who makes an installation available to other people is responsible for
securing it, explaining their own data practices, and complying with applicable
privacy laws and Spotify's terms.
