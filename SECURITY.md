# Security Policy

Please do not open a public issue for a vulnerability or accidentally exposed
Spotify credential. Report security issues privately through GitHub's
**Security → Report a vulnerability** feature.

Never commit `.env`, Spotify client secrets, OAuth tokens, Wi-Fi credentials,
or `firmware/include/config.h`. If a credential is exposed, revoke or rotate it
before removing it from Git history.

This project is designed for a trusted home LAN. Do not expose its HTTP server
directly to the public internet.
