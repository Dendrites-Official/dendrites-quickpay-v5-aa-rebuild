FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src ./src
EXPOSE 8787
CMD ["npm","run","start"]
