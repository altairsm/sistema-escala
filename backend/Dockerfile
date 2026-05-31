FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/
COPY start.sh ./start.sh

RUN mkdir -p /tmp/uploads && chmod +x start.sh

EXPOSE 3000

CMD ["./start.sh"]
