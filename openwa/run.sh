#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

export SESSION_ID="$(bashio::config 'session_id')"
export BASE_TOPIC="$(bashio::config 'base_topic')"
export DISCOVERY_PREFIX="$(bashio::config 'discovery_prefix')"
export LICENSE_KEY="$(bashio::config 'license_key')"
export USER_AGENT="$(bashio::config 'user_agent')"
export CHROMIUM_ARGS="$(bashio::config 'chromium_args')"
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

bashio::log.info "Starting open-wa WhatsApp bridge (session: ${SESSION_ID})."
bashio::log.info "On first run, scan the QR code shown in these logs: WhatsApp > Settings > Linked Devices."

exec node /opt/openwa/bridge.js
