'use strict';

const http = require('http');
const mqtt = require('mqtt');
const qrcode = require('qrcode-terminal');
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

// --- Health endpoint (watchdog): 200 while the process is alive ---
function startHealthServer() {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    })
    .listen(8090, () => log('Health endpoint listening on :8090'));
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

// WhatsApp -> HA.
function handleIncoming(msg) {
  const isGroup = typeof msg.from === 'string' && msg.from.endsWith('@g.us');
  const out = {
    from: msg.from,
    to: msg.to,
    chatId: msg.from,
    sender: (msg._data && msg._data.notifyName) || msg.author || msg.from,
    author: msg.author || null,
    body: msg.body || '',
    type: msg.type,
    isGroup,
    timestamp: msg.timestamp,
    id: msg.id && msg.id._serialized,
  };
  if (mqttClient) mqttClient.publish(TOPIC.message, JSON.stringify(out), { qos: 1 });
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
    },
    userAgent: USER_AGENT || undefined,
    webVersionCache,
    takeoverOnConflict: true,
    qrMaxRetries: 0,
  });
}

function wireEvents(client) {
  client.on('qr', (qr) => {
    log('>>> Scan this QR with WhatsApp > Linked Devices > Link a Device:');
    qrcode.generate(qr, { small: true });
  });
  client.on('loading_screen', (percent, message) => log(`Loading WhatsApp: ${percent}% ${message || ''}`));
  client.on('authenticated', () => log('WhatsApp authenticated; session saved.'));
  client.on('auth_failure', (m) => log('Auth failure:', m));
  client.on('ready', () => {
    log('WhatsApp connected. Bridge is ready.');
    publishStatus(true);
  });
  client.on('disconnected', (reason) => {
    log('WhatsApp disconnected:', reason);
    publishStatus(false);
  });
  client.on('message', handleIncoming);
}

async function main() {
  if (!MQTT_HOST) {
    log('Fatal: MQTT_HOST not set');
    process.exit(1);
  }
  startHealthServer();
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
