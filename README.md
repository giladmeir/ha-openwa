# Home Assistant add-on: WhatsApp (open-wa)

A Home Assistant add-on repository that connects Home Assistant to **WhatsApp** using
[`@open-wa/wa-automate`](https://github.com/open-wa/wa-automate-nodejs), bridged over **MQTT**.
Send WhatsApp messages from HA and receive incoming messages as automation triggers.

## Installation

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add: `https://github.com/giladmeir/ha-openwa`
3. Install **WhatsApp Bridge (open-wa)**, then start it and scan the QR code from its **Log** tab.

Requires the **Mosquitto broker** add-on and the **MQTT** integration.

See [openwa/DOCS.md](openwa/DOCS.md) for full usage (sending, receiving, discovery entities).

## Add-ons

| Add-on | Description |
| --- | --- |
| [WhatsApp Bridge (open-wa)](openwa) | open-wa ↔ Home Assistant over MQTT (send + receive). |

## Disclaimer

This uses unofficial WhatsApp Web automation. Use at your own risk, preferably with a
secondary number. Not affiliated with or endorsed by WhatsApp/Meta.
