'use strict';

const http = require('http');
const mqtt = require('mqtt');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const {
  SESSION_ID = 'ha',
  BASE_TOPIC = 'openwa',
  DISCOVERY_PREFIX = 'homeassistant',
  DATA_PATH = '/data',
  MQTT_HOST,
  MQTT_PORT = '1883',
  MQTT_USER = '',
  MQTT_PASS = '',
  MQTT_SSL = 'false',
  CHROME_BIN = '/usr/bin/chromium-browser',
  CHROMIUM_ARGS = '--no-sandbox,--disable-dev-shm-usage',
  USER_AGENT = '',
  WEB_VERSION = '',
  PROTOCOL_TIMEOUT = '120000',
  WEB_PORT = '8099',
  SELF_COMMAND_PREFIX = '',
  SELF_POLL_SECONDS = '4',
  POLL_CHAT_IDS = '',
} = process.env;

const chromiumArgs = CHROMIUM_ARGS.split(',')
  .map((a) => a.trim())
  .filter(Boolean);

const TOPIC = {
  status: `${BASE_TOPIC}/status`,
  message: `${BASE_TOPIC}/message`,
  send: `${BASE_TOPIC}/send`,
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

let waClient = null;
let waReady = false;
let mqttClient = null;
let ownId = null;
const selfPrefix = SELF_COMMAND_PREFIX.trim().toLowerCase();
const selfPollSeconds = Number.isFinite(parseInt(SELF_POLL_SECONDS, 10)) ? parseInt(SELF_POLL_SECONDS, 10) : 4;
const processedIds = new Set();
const pollChatIds = POLL_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
let lastPollTs = 0;
let pollerStarted = false;

// UI state, surfaced through the ingress web page (no noisy QR logs).
const ui = { status: 'starting', qr: null, qrAt: 0, updatedAt: Date.now() };
function setUi(patch) {
  Object.assign(ui, patch, { updatedAt: Date.now() });
}

function renderPage() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Bridge</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px;text-align:center;background:#f6f8fa;color:#1f2328}
  .card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:24px}
  h1{font-size:18px;margin:0 0 16px}
  .qr{width:280px;height:280px;image-rendering:pixelated;border:1px solid #d0d7de;border-radius:8px}
  .ok{font-size:20px;color:#1a7f37;margin-bottom:8px}
  .muted{color:#656d76;font-size:13px}
  .status{font-size:12px;color:#656d76;margin-top:16px}
</style></head>
<body><div class="card"><h1>WhatsApp Bridge</h1>
<div id="content"><p class="muted">Loading…</p></div>
<div class="status">status: <span id="st">…</span></div></div>
<script>
// Poll a tiny status endpoint (no full-page reloads). Stop once connected.
var lastQrAt = 0, timer = null;
function render(s) {
  document.getElementById('st').textContent = s.status;
  var c = document.getElementById('content');
  if (s.status === 'connected') {
    c.innerHTML = '<div class="ok">✅ Connected to WhatsApp</div><p>The bridge is linked and ready. You can close this page.</p>';
    if (timer) { clearInterval(timer); timer = null; }
    return;
  }
  if (s.hasQr) {
    if (s.qrAt !== lastQrAt) {
      lastQrAt = s.qrAt;
      c.innerHTML = '<p>Scan this QR in <b>WhatsApp → Settings → Linked Devices → Link a Device</b>:</p>'
        + '<img class="qr" src="qr.png?ts=' + s.qrAt + '" alt="WhatsApp QR code" />'
        + '<p class="muted">The code refreshes automatically.</p>';
    }
  } else {
    c.innerHTML = '<p class="muted">Starting WhatsApp… waiting for a QR code.</p>';
  }
}
function poll() {
  fetch('status', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(render).catch(function(){});
}
poll();
timer = setInterval(poll, 4000);
</script>
</body></html>`;
}

// Serves the ingress QR/status page, a PNG of the current QR, and a watchdog health check.
function startWebServer() {
  const port = parseInt(WEB_PORT, 10) || 8099;
  http
    .createServer(async (req, res) => {
      const path = (req.url || '/').split('?')[0];
      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }
      if (path.endsWith('/status')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ status: ui.status, hasQr: !!ui.qr, qrAt: ui.qrAt }));
      }
      if (path.endsWith('/qr.png')) {
        if (!ui.qr) {
          res.writeHead(404);
          return res.end();
        }
        try {
          const png = await QRCode.toBuffer(ui.qr, { width: 280, margin: 1 });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          return res.end(png);
        } catch {
          res.writeHead(500);
          return res.end();
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderPage());
    })
    .listen(port, () => log(`Web UI + health listening on :${port}`));
}

// --- MQTT ---
function connectMqtt() {
  const proto = MQTT_SSL === 'true' ? 'mqtts' : 'mqtt';
  const url = `${proto}://${MQTT_HOST}:${MQTT_PORT}`;
  const client = mqtt.connect(url, {
    username: MQTT_USER || undefined,
    password: MQTT_PASS || undefined,
    reconnectPeriod: 5000,
    will: { topic: TOPIC.status, payload: 'offline', retain: true, qos: 1 },
  });

  client.on('connect', () => {
    log('MQTT connected to', url);
    client.subscribe(TOPIC.send, { qos: 1 });
    publishDiscovery(client);
    client.publish(TOPIC.status, waReady ? 'online' : 'offline', { retain: true, qos: 1 });
  });
  client.on('message', (topic, payload) => {
    if (topic === TOPIC.send) handleSendRequest(payload);
  });
  client.on('error', (err) => log('MQTT error:', err.message));
  return client;
}

function publishStatus(online) {
  waReady = online;
  if (mqttClient) mqttClient.publish(TOPIC.status, online ? 'online' : 'offline', { retain: true, qos: 1 });
}

// Auto-create HA entities via MQTT discovery.
function publishDiscovery(client) {
  const device = {
    identifiers: [`openwa_${SESSION_ID}`],
    name: 'WhatsApp Bridge',
    manufacturer: 'whatsapp-web.js',
    model: 'HA WhatsApp Bridge',
  };
  const opts = { retain: true, qos: 1 };

  client.publish(
    `${DISCOVERY_PREFIX}/binary_sensor/openwa_${SESSION_ID}/status/config`,
    JSON.stringify({
      name: 'WhatsApp Bridge',
      unique_id: `openwa_${SESSION_ID}_status`,
      device_class: 'connectivity',
      state_topic: TOPIC.status,
      payload_on: 'online',
      payload_off: 'offline',
      device,
    }),
    opts,
  );

  client.publish(
    `${DISCOVERY_PREFIX}/sensor/openwa_${SESSION_ID}/last_message/config`,
    JSON.stringify({
      name: 'WhatsApp Last Message',
      unique_id: `openwa_${SESSION_ID}_last_message`,
      icon: 'mdi:whatsapp',
      state_topic: TOPIC.message,
      value_template: '{{ value_json.body[:255] }}',
      json_attributes_topic: TOPIC.message,
      availability_topic: TOPIC.status,
      device,
    }),
    opts,
  );
  log('Published MQTT discovery config');
}

// Normalise a recipient to a WhatsApp chat id.
function toChatId(to) {
  if (!to) return null;
  const raw = String(to).trim();
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `${digits}@c.us` : null;
}

// HA -> WhatsApp. Payload: {"to": "...", "message": "..."} or {"to","image","caption","filename"}.
async function handleSendRequest(payload) {
  if (!waClient || !waReady) return log('Send dropped: WhatsApp not ready yet');
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return log('Send dropped: payload is not valid JSON');
  }
  const chatId = toChatId(data.to);
  if (!chatId) return log('Send dropped: missing/invalid "to"');
  try {
    if (data.image) {
      const media = /^https?:\/\//i.test(data.image)
        ? await MessageMedia.fromUrl(data.image, { unsafeMime: true })
        : new MessageMedia(data.mimetype || 'image/jpeg', data.image, data.filename || 'image.jpg');
      await waClient.sendMessage(chatId, media, { caption: data.caption || '' });
    } else {
      await waClient.sendMessage(chatId, String(data.message ?? ''));
    }
    log('Sent message to', chatId);
  } catch (err) {
    log('Send failed:', err.message);
  }
}

// WhatsApp -> HA. Shared publisher for both received and (opt-in) self-sent messages.
// Deduplicates by message id so the event and polling paths never double-publish.
function publishIncoming(msg, fromMe) {
  const id = msg.id && msg.id._serialized;
  if (id) {
    if (processedIds.has(id)) return;
    processedIds.add(id);
    if (processedIds.size > 1000) processedIds.clear();
  }
  const isGroup = typeof msg.from === 'string' && msg.from.endsWith('@g.us');
  const author = fromMe ? ownId || msg.to : msg.author || null;
  const out = {
    from: msg.from,
    to: msg.to,
    chatId: msg.from,
    sender: (msg._data && msg._data.notifyName) || author || msg.from,
    author,
    body: msg.body || '',
    type: msg.type,
    isGroup,
    fromMe: !!fromMe,
    timestamp: msg.timestamp,
    id,
  };
  if (mqttClient) mqttClient.publish(TOPIC.message, JSON.stringify(out), { qos: 1 });
}

function handleIncoming(msg) {
  publishIncoming(msg, false);
}

// Messages sent BY the linked account (e.g. the owner typing in the family group, or
// "message yourself"). Only forwarded when SELF_COMMAND_PREFIX is set and matched, to
// avoid leaking normal chat activity and to prevent reply loops.
function handleSelfMessage(msg) {
  if (!selfPrefix || !msg.fromMe) return;
  const body = (msg.body || '').trim().toLowerCase();
  if (!body.startsWith(selfPrefix)) return;
  publishIncoming(msg, true);
}

// WhatsApp multi-device does not reliably fire events for messages sent from the linked
// phone, so we also poll for owner commands (deduped by id). We poll specific chats by id
// (getChatById + fetchMessages) because whole-account getChats() is unreliable/broken in
// current WhatsApp Web.
async function pollOnce(client) {
  const now = Math.floor(Date.now() / 1000);
  const scan = (msgs) => {
    for (const m of msgs || []) {
      if (!m || !m.fromMe) continue;
      if ((m.timestamp || 0) < lastPollTs) continue;
      const body = (m.body || '').trim().toLowerCase();
      if (!body.startsWith(selfPrefix)) continue;
      publishIncoming(m, true);
    }
  };

  if (pollChatIds.length) {
    for (const id of pollChatIds) {
      try {
        const chat = await client.getChatById(id);
        scan(await chat.fetchMessages({ limit: 10 }));
      } catch { /* chat not found yet / transient — ignore */ }
    }
  } else {
    // Best-effort fallback if no chat ids configured.
    const chats = await client.getChats();
    scan(chats.map((c) => c.lastMessage));
  }
  lastPollTs = now;
}

function startSelfPoller(client) {
  if (pollerStarted || !selfPrefix || !(selfPollSeconds > 0)) return;
  pollerStarted = true;
  lastPollTs = Math.floor(Date.now() / 1000);
  setInterval(() => {
    if (!waReady) return;
    pollOnce(client).catch((err) => log('Self-poll error:', err.message));
  }, selfPollSeconds * 1000);
  log(
    `Self-message polling every ${selfPollSeconds}s (prefix "${selfPrefix}", chats: ${pollChatIds.length ? pollChatIds.join(', ') : 'all'})`,
  );
}

function buildClient() {
  const webVersionCache = WEB_VERSION
    ? {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WEB_VERSION}.html`,
      }
    : undefined;

  return new Client({
    authStrategy: new LocalAuth({ clientId: SESSION_ID, dataPath: DATA_PATH }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_BIN,
      args: chromiumArgs,
      protocolTimeout: parseInt(PROTOCOL_TIMEOUT, 10) || 120000,
    },
    userAgent: USER_AGENT || undefined,
    webVersionCache,
    takeoverOnConflict: true,
    qrMaxRetries: 0,
  });
}

function wireEvents(client) {
  client.on('qr', (qr) => {
    setUi({ status: 'qr', qr, qrAt: Date.now() });
    log('QR code ready — open the add-on Web UI (Open Web UI) to scan it.');
  });
  client.on('loading_screen', (percent, message) => log(`Loading WhatsApp: ${percent}% ${message || ''}`));
  client.on('authenticated', () => log('WhatsApp authenticated; session saved.'));
  client.on('auth_failure', (m) => {
    setUi({ status: 'auth_failure' });
    log('Auth failure:', m);
  });
  client.on('ready', () => {
    log('WhatsApp connected. Bridge is ready.');
    try {
      ownId = client.info && client.info.wid && client.info.wid._serialized;
      if (ownId) log('Linked account:', ownId);
    } catch { /* ignore */ }
    setUi({ status: 'connected', qr: null });
    publishStatus(true);
    startSelfPoller(client);
  });
  client.on('disconnected', (reason) => {
    log('WhatsApp disconnected:', reason);
    setUi({ status: 'disconnected', qr: null });
    publishStatus(false);
  });
  client.on('message', handleIncoming);
  if (selfPrefix) client.on('message_create', handleSelfMessage);
}

async function main() {
  if (!MQTT_HOST) {
    log('Fatal: MQTT_HOST not set');
    process.exit(1);
  }
  startWebServer();
  mqttClient = connectMqtt();

  log('Launching WhatsApp (whatsapp-web.js)...');
  waClient = buildClient();
  wireEvents(waClient);
  await waClient.initialize();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
