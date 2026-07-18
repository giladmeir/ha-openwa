ARG BUILD_FROM
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser

# Node.js runtime + system Chromium (puppeteer's bundled build has no aarch64 binary)
RUN apk add --no-cache \
        nodejs \
        npm \
        chromium \
        nss \
        freetype \
        harfbuzz \
        ca-certificates \
        ttf-freefont

WORKDIR /opt/openwa

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY bridge.js ./
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
