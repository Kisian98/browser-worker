FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3080
ENV BROWSER_WORKER_HOST=0.0.0.0
ENV BROWSER_WORKER_ARTIFACT_ROOT=/artifacts

EXPOSE 3080

CMD ["npm", "start"]
