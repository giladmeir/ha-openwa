# Continuing Work

## Restore context

1. Read `AGENTS.md`, `docs/SESSION_CONTEXT.md`, `README.md`, and `openwa/DOCS.md`.
2. Inspect the current state:

   ```bash
   git status --short
   git branch -vv
   git log --oneline --decorate -20
   gh pr list --state all --limit 20
   ```

3. Check `openwa/config.yaml`, `openwa/Dockerfile`, and the Node application before
   changing options, ports, health checks, Chromium behavior, or auth.

## Current continuation point

- Version `0.7.0` runs `whatsapp-web.js` in a Home Assistant add-on on ARM64/AMD64.
- MQTT send/receive, discovery entities, ingress QR/status UI, owner-command polling,
  specific-chat polling, group-ID correction, and an authenticated HTTP send API
  are implemented.
- HTTP callers may use a static API key or verified Firebase ID tokens with optional
  email/UID allowlists.
- Startup resilience and Chromium/Puppeteer timeouts were hardened for Raspberry Pi
  Home Assistant OS.

## Validation and release

Run the repository's package checks and build the add-on image for affected
architectures. For a release, update the add-on version and changelog consistently,
push the repository, reload the Home Assistant add-on store, and verify upgrade,
startup, health, QR/session persistence, MQTT, and HTTP authentication.

## Update this handoff

After a meaningful session, add durable decisions and release references to
`docs/SESSION_CONTEXT.md`, update the continuation point, and never record WhatsApp
session material, tokens, phone numbers, chat IDs, or Home Assistant state.

