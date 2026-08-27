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
| `self_command_prefix` | `""` | If set, messages **sent by the linked account** (e.g. the owner typing in a family group, or "message yourself") that start with this word are also forwarded to HA. Enables controlling HA from the same phone. Empty = only forward messages received from others. |
| `self_poll_seconds` | `4` | How often (seconds) to poll for owner-sent commands, since WhatsApp multi-device doesn't reliably emit events for messages sent from the linked phone. `0` disables polling. Only used when `self_command_prefix` is set. |
| `poll_chat_ids` | `""` | Comma-separated chat ids to poll for owner commands (e.g. the family group `1203...@g.us` and/or your self-chat `<number>@c.us`). Recommended — whole-account scanning is unreliable in current WhatsApp Web. Empty = best-effort scan of all chats. |
| `api_key` | `""` | Enables the HTTP send API (see below) when set. External services must send this as a Bearer token. Empty = API disabled. |
| `default_send_to` | `""` | Default chat id the HTTP API sends to when a request omits `to` (e.g. your group `1203...@g.us`). |
| `protocol_timeout` | `120000` | Puppeteer CDP timeout (ms). Raise if Chromium is slow to respond and you see `Network.enable timed out`. |
| `create_retries` | `3` | Reserved for launch retries. |
| `log_level` | `info` | Add-on log level. |

## First run — link your phone

1. Start the add-on, then click **Open Web UI** (or the **WhatsApp** item in the sidebar).
2. A QR code is shown on that page. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, then scan it.
3. The page refreshes the code automatically and shows **✅ Connected** once linked.
4. The session is saved to `/data`, so you only scan once (survives restarts/updates).

> The QR is shown in the Web UI (not spammed into the logs), so the add-on stays quiet and
> doesn't flood the Supervisor log stream.

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

## HTTP send API (connector / proxy for external services)

Enable the connector by setting **either** `api_key` (a static shared secret) **or**
`firebase_project_id` (verify Firebase ID tokens). The add-on then exposes an authenticated
HTTP endpoint on port **8098** so any external service can relay a message into WhatsApp.

- **Endpoint:** `POST http://<home-assistant-host>:8098/api/send`
- **Auth:** header `Authorization: Bearer <token>` (or `X-API-Key: <token>`), where `<token>` is
  either a **Firebase ID token** of an authorized user, or the static `api_key`.
- **Body (JSON):**
  - `message` — text to send (or use `image`)
  - `to` — optional chat id; falls back to `default_send_to`
  - `image` — optional URL or base64; `caption`, `filename`, `mimetype` optional
- **Responses:** `200 {ok:true,chatId}`; `401` bad/expired token; `400` bad body; `502` send failed.

### Firebase-authorized access (recommended)

Restrict the connector to your **Firebase-authenticated personnel**:

| Option | Description |
| --- | --- |
| `firebase_project_id` | Your Firebase project id. Incoming Bearer tokens are verified as Firebase ID tokens for this project. |
| `firebase_allowed_emails` | Optional comma-separated allowlist of emails; only these verified users may send. Empty = any signed-in user in the project. |
| `firebase_allowed_uids` | Optional comma-separated allowlist of Firebase UIDs. |

Your external service (e.g. a web app or backend acting for a signed-in user) obtains the user's
Firebase **ID token** and sends it as the Bearer token:

```bash
curl -X POST http://homeassistant.local:8098/api/send \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Deploy finished ✅"}'
```

Verification only needs the project id (Google's public keys are fetched automatically); no
service-account file is required.

### Static key (optional, for machine-to-machine)

If you also set `api_key`, that exact string is accepted as a Bearer token — handy for simple
server-to-server calls that can't mint Firebase tokens:

```bash
curl -X POST http://homeassistant.local:8098/api/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"to": "15551234567", "image": "https://example.com/chart.png", "caption": "Daily report"}'
```

> Exposed on the local network by default. For internet access, route port 8098 through your
> existing Cloudflare Tunnel or Tailscale rather than opening a router port.
