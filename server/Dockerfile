FROM node:24-alpine
WORKDIR /srv
COPY dist ./dist
COPY server ./server
ENV PORT=8420
EXPOSE 8420
CMD ["node", "server/server.mjs"]
