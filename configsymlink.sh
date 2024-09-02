#!/bin/bash

if [ ! -f /config/config.json ]; then
    cp /config_default/config.json /config
fi

ln -sf /config/config.json /app/config.json