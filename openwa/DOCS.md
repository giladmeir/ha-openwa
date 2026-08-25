# WhatsApp Bridge (whatsapp-web.js)

Connects Home Assistant to WhatsApp using [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js)
and bridges everything over MQTT. Lets you **send** WhatsApp messages from HA and **receive**
incoming messages as triggers.

> ⚠️ This drives *WhatsApp Web* through a headless browser linked as a companion device to a real
> WhatsApp account. It is unofficial automation — there is a small risk of your number being
> flagged. A secondary/dedicated number is recommended. Needs ~1 GB RAM (Pi 4/5 recommended).

## Requirements

- The **Mosquitto broker** add-on installed and started.
- The **MQTT** integration configured in Home Assistant (Settings → Devices & Services → MQTT).

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `session_id` | `ha` | Session name; the WhatsApp login is persisted under `/data`. |
| `base_topic` | `openwa` | MQTT base topic. |
| `discovery_prefix` | `homeassistant` | MQTT discovery prefix (match your MQTT integration). |
| `user_agent` | `""` | Optional browser user-agent override. Leave empty to use the library default. |
| `chromium_args` | `--no-sandbox,--disable-dev-shm-usage` | Comma-separated Chromium flags. `--no-sandbox` is required to run headless Chromium as root in the container. |
| `web_version` | `""` | Optional WhatsApp Web version to pin (e.g. `2.3000.1023204347-alpha`) from the wa-version cache, if the live version ever breaks. Empty = use live. |
| `create_retries` | `3` | Reserved for launch retries. |
| `log_level` | `info` | Add-on log level. |

## First run — link your phone

1. Start the add-on and open its **Log** tab.
2. A QR code is printed in the log. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, then scan it.
3. The session is saved to `/data`, so you only scan once (survives restarts/updates).

The add-on auto-creates two entities via MQTT discovery:

- `binary_sensor.whatsapp_bridge` — connectivity (on = linked & online).
- `sensor.whatsapp_last_message` — last received message; attributes hold `from`, `sender`,
  `body`, `chatId`, `isGroup`, etc.

## Sending a message from Home Assistant

Publish JSON to `openwa/send`:

```yaml
service: mqtt.publish
data:
  topic: openwa/send
  payload: >
    {"to": "15551234567", "message": "Hello from Home Assistant!"}
```

- `to` — phone number **with country code, no `+`/spaces** (e.g. `15551234567`), or a full
  chat id (`15551234567@c.us` for a person, `<id>@g.us` for a group).
- Send an image instead of text with `{"to": "...", "image": "<url or base64>", "caption": "..."}`.

A ready-made **Send WhatsApp** script (fields: `target`, `message`) is created for you, so you can
also call `script.send_whatsapp`.

## Receiving messages / triggering automations

Every incoming message is published to `openwa/message`. Trigger example:

```yaml
alias: WhatsApp command - lights on
trigger:
  - platform: mqtt
    topic: openwa/message
condition:
  - condition: template
    value_template: "{{ trigger.payload_json.body | lower == 'lights on' }}"
action:
  - service: light.turn_on
    target: { entity_id: light.living_room }
```

`trigger.payload_json` fields: `from`, `chatId`, `sender`, `body`, `type`, `isGroup`, `timestamp`, `id`.
