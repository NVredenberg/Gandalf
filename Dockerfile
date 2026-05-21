FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-deu \
    tesseract-ocr-data-eng

COPY package*.json ./
RUN npm install --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY templates ./templates
COPY README.md ./
COPY data/examples ./data/examples

RUN mkdir -p data/uploads

EXPOSE 3000

CMD ["node", "backend/server.js"]
