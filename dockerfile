FROM node:20-bullseye


RUN mkdir /app
COPY index.js /app
COPY package.json /app

WORKDIR /app
RUN apt update \
    && apt upgrade -y \
    && npm install

ENTRYPOINT ["node", "/app/index.js"]