FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p /tmp/uploads

EXPOSE 3000

CMD ["node", "src/app.js"]
