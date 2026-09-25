# Session Context

## Available session catalog

| Date | Session | Durable contribution |
| --- | --- | --- |
| 2026-07-18 to 2026-08-29 | `4f862dca-578f-4a9f-8903-ffa28b2203de` — Connect Home Assistant to WhatsApp | Built and operated the add-on from the initial open-wa bridge through the whatsapp-web.js migration, ingress QR UI, MQTT behavior, owner-command polling, group handling, external HTTP API, Firebase authentication, and startup resilience. |

Related Home Assistant sessions discussed using WhatsApp as a HomeOS/HA integration,
but this repository contains the durable implementation.

## Release timeline

- `3e86c81`: initial open-wa Home Assistant add-on.
- `31bcd6f`: ARM launch fix.
- `019a066`: migration to `whatsapp-web.js`.
- `9ce7c9a`: Chromium timeout hardening.
- `8e1ad98` and `f4ae3c4`: ingress QR/status UI and self-message forwarding.
- `5a0b374` and `96a396a`: owner-command polling and explicit chat polling.
- `b2dbdcd`: correct real group ID instead of `@lid` alias.
- `1cdeee2`: authenticated HTTP send API.
- `6de0e6e`: Firebase authentication and startup resilience, version `0.7.0`.

## Durable constraints

- This is unofficial WhatsApp Web automation; recommend a secondary number.
- Keep `/data` session persistence compatible across upgrades.
- Do not expose the HTTP endpoint publicly without a protected tunnel and valid auth.
- Preserve MQTT topics and discovery contracts or document a migration.
- Validate on Raspberry Pi/ARM64 because Chromium behavior is a primary failure mode.

