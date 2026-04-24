FROM node:24-bookworm

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/

ENV HOST=0.0.0.0
ENV PORT=8741

CMD ["node", "src/server.js"]
