FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PAPER_AUTO=false
ENV LIVE=false
EXPOSE 8080
CMD ["npx", "vite", "preview", "--host", "127.0.0.1", "--port", "8080"]
