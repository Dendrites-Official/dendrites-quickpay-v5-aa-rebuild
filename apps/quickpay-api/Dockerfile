FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src ./src
EXPOSE 8787
CMD ["npm","run","start"]
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
