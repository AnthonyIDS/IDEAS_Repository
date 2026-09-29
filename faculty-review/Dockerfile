FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server/index.mjs"]
