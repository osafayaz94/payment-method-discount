FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
# Keep the database on a mounted volume so it survives redeploys.
ENV DATABASE_URL=file:/data/app.sqlite
RUN mkdir -p /data

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
