# syntax=docker/dockerfile:1

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV XCFG_STORE=memory

COPY package.json ./package.json
COPY src ./src

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.PORT||8080;const req=http.request({host:'127.0.0.1',port,path:'/healthz',method:'GET'},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.end();"

CMD ["node", "src/server.js"]

