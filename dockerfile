FROM node:20-bullseye


RUN mkdir /app
COPY index.js /app
COPY package.json /app

RUN mkdir /config_default
COPY docker/start.sh /config_default
COPY config.json /config_default

RUN chmod +x /config_default/start.sh
RUN mkdir /config

WORKDIR /app
RUN apt update \
    && apt upgrade -y \
    && npm install

ENTRYPOINT ["bash", "/config_default/start.sh"]