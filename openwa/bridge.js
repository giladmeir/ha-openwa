'use strict';

const http = require('http');
const mqtt = require('mqtt');
const { create, ev } = require('@open-wa/wa-automate');

const {
  SESSION_ID = 'ha',
  BASE_TOPIC = 'openwa',
  DISCOVERY_PREFIX = 'homeassistant',
  LICENSE_KEY = '',
  DATA_PATH = '/data',
  MQTT_HOST,
  MQTT_PORT = '1883',
  MQTT_USER = '',
  MQTT_PASS = '',
  MQTT_SSL = 'false',
  CHROME_BIN = '/usr/bin/chromium-browser',
} = process.env;

const TOPIC = {
  status: `${BASE_TOPIC}/status`,
  message: `${BASE_TOPIC}/message`,
  send: `${BASE_TOPIC}/send`,
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

let waClient = null;

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
    client.publish(TOPIC.status, waClient ? 'online' : 'offline', { retain: true, qos: 1 });
  });
  client.on('message', (topic, payload) => {
    if (topic === TOPIC.send) handleSendRequest(payload);
  });
  client.on('error', (err) => log('MQTT error:', err.message));
  return client;
}

// Auto-create HA entities via MQTT discovery.
function publishDiscovery(client) {
  const device = {
    identifiers: [`openwa_${SESSION_ID}`],
    name: 'WhatsApp Bridge',
    manufacturer: 'open-wa',
    model: 'wa-automate',
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
  if (!waClient) return log('Send dropped: WhatsApp not ready yet');
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
      await waClient.sendImage(chatId, data.image, data.filename || 'image.jpg', data.caption || '');
    } else {
      await waClient.sendText(chatId, String(data.message ?? ''));
    }
    log('Sent message to', chatId);
  } catch (err) {
    log('Send failed:', err.message);
  }
}

// WhatsApp -> HA.
function wireWhatsapp(client, mqttClient) {
  client.onMessage((m) => {
    const out = {
      from: m.from,
      chatId: m.chatId,
      sender: (m.sender && (m.sender.pushname || m.sender.formattedName)) || m.notifyName || '',
      body: m.body || m.caption || '',
      type: m.type,
      isGroup: m.isGroupMsg === true,
      timestamp: m.timestamp,
      id: m.id,
    };
    mqttClient.publish(TOPIC.message, JSON.stringify(out), { qos: 1 });
  });

  client.onStateChanged((state) => {
    log('WhatsApp state:', state);
    const online = state === 'CONNECTED';
    mqttClient.publish(TOPIC.status, online ? 'online' : 'offline', { retain: true, qos: 1 });
    if (['CONFLICT', 'UNLAUNCHED', 'UNPAIRED'].includes(state)) client.forceRefocus();
  });
}

async function main() {
  if (!MQTT_HOST) {
    log('Fatal: MQTT_HOST not set');
    process.exit(1);
  }
  startHealthServer();
  const mqttClient = connectMqtt();

  ev.on('qr.**', () =>
    log('>>> QR code ready. Scan it from these logs: WhatsApp > Linked Devices > Link a Device.'),
  );

  log('Launching WhatsApp (open-wa)...');
  waClient = await create({
    sessionId: SESSION_ID,
    sessionDataPath: DATA_PATH,
    multiDevice: true,
    headless: true,
    qrTimeout: 0,
    authTimeout: 0,
    autoRefresh: true,
    cacheEnabled: false,
    useChrome: false,
    executablePath: CHROME_BIN,
    disableSpins: true,
    logConsole: false,
    popup: false,
    licenseKey: LICENSE_KEY || undefined,
    chromiumArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  wireWhatsapp(waClient, mqttClient);
  mqttClient.publish(TOPIC.status, 'online', { retain: true, qos: 1 });
  log('WhatsApp connected. Bridge is ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
