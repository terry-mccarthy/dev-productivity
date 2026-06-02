FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY server/package*.json server/
RUN cd server && npm install --omit=dev

COPY server/ server/
COPY index.html dev-productivity.jsx ./

ENV PORT=3003 \
    DB_PATH=/data/devpulse.db \
    THREAT_INTEL_DIR=/app/server/threat-intel

EXPOSE $PORT

CMD ["node", "server/index.js"]
