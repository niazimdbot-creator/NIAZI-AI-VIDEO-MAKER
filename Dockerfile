FROM node:20-bookworm

RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p public/generated

EXPOSE 3000

CMD ["npm", "start"]
