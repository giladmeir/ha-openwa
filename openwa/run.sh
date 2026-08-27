#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

export SESSION_ID="$(bashio::config 'session_id')"
export BASE_TOPIC="$(bashio::config 'base_topic')"
export DISCOVERY_PREFIX="$(bashio::config 'discovery_prefix')"
export USER_AGENT="$(bashio::config 'user_agent')"
export CHROMIUM_ARGS="$(bashio::config 'chromium_args')"
export WEB_VERSION="$(bashio::config 'web_version')"
export SELF_COMMAND_PREFIX="$(bashio::config 'self_command_prefix')"
export SELF_POLL_SECONDS="$(bashio::config 'self_poll_seconds')"
export POLL_CHAT_IDS="$(bashio::config 'poll_chat_ids')"
export API_KEY="$(bashio::config 'api_key')"
export DEFAULT_SEND_TO="$(bashio::config 'default_send_to')"
export FIREBASE_PROJECT_ID="$(bashio::config 'firebase_project_id')"
export FIREBASE_ALLOWED_EMAILS="$(bashio::config 'firebase_allowed_emails')"
export FIREBASE_ALLOWED_UIDS="$(bashio::config 'firebase_allowed_uids')"
export PROTOCOL_TIMEOUT="$(bashio::config 'protocol_timeout')"
export CREATE_RETRIES="$(bashio::config 'create_retries')"
export DATA_PATH="/data"

if bashio::services.available 'mqtt'; then
    export MQTT_HOST="$(bashio::services 'mqtt' 'host')"
    export MQTT_PORT="$(bashio::services 'mqtt' 'port')"
    export MQTT_USER="$(bashio::services 'mqtt' 'username')"
    export MQTT_PASS="$(bashio::services 'mqtt' 'password')"
    export MQTT_SSL="$(bashio::services 'mqtt' 'ssl')"
    bashio::log.info "Using MQTT broker at ${MQTT_HOST}:${MQTT_PORT}"
else
    bashio::log.fatal "No MQTT service available. Install and start the Mosquitto broker add-on."
    bashio::exit.nok
fi

bashio::log.info "Starting WhatsApp bridge (whatsapp-web.js, session: ${SESSION_ID})."
bashio::log.info "On first run, scan the QR code shown in these logs: WhatsApp > Settings > Linked Devices."

exec node /opt/openwa/bridge.js
