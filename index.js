const Gpsd = require('node-gpsd-client');
const http = require('http');
const net = require('net');
const haversine = require("haversine-distance");
const { EOL } = require("os");

const LOG_LEVELS = { DEBUG: 0, INFO: 1, ERROR: 2 };
const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.INFO;
const log = {
    debug: (...args) => LOG_LEVEL <= LOG_LEVELS.DEBUG && console.log(...args),
    info:  (...args) => LOG_LEVEL <= LOG_LEVELS.INFO  && console.log(...args),
    error: (...args) => LOG_LEVEL <= LOG_LEVELS.ERROR && console.error(...args),
};

let config = null;
try{
    config = require('./config.json');
}
catch (e){
    throw new Error("FAILED TO LOAD config.json FILE" +  EOL + e);
}

const PROTOCOL_OSMAND = 'osmand';
const PROTOCOL_H02  = 'h02';
const protocol = (config.protocol || PROTOCOL_OSMAND).toLowerCase();

const client = new Gpsd({
  port: config.gpsd_port,
  hostname: config.gpsd_host,
  parse: true
})

client.on('connected', () => {
    log.info('Gpsd connected')
    client.watch({
        class: 'WATCH',
        json: true,
        scaled: true
    })
})

client.on('error', err => {
    log.error(`Gpsd error: ${err.message}`)
})

let historicTPV = []
let cachedTPV = null;
let lastMessageTime = new Date(0);

client.on('TPV', data => {
    //first check mode, 1 = no fix, 2 = 2d fix, 3 = 3d fix
    if(data.device == config.gps_device){
        let now = new Date(Date.now());
        let cutoffTime = new Date(Date.now() - config.static_distance_measure_time);

        if(data.mode > 1){
            cachedTPV = data;
            historicTPV.push(data);
            while(historicTPV.length > 0 && new Date(historicTPV[0].time) < cutoffTime)
            {
                historicTPV.shift();
            }
        }
        else{
            cachedTPV = null;
            previousTPV= null;
        }
        lastMessageTime = now;
    }

})

let cachedSKY = null;
client.on('SKY', data => {
    cachedSKY = data;
})

client.connect()

// --- H02 TCP connection ---
let h02Socket = null;
let h02Connected = false;

function h02Connect() {
    const url = new URL(config.server_url);
    const host = url.hostname;
    const port = parseInt(url.port) || 5013;

    log.info(`H02: connecting to ${host}:${port}`);
    h02Socket = new net.Socket();

    h02Socket.connect(port, host, () => {
        log.info('H02: connected');
        h02Connected = true;
    });

    h02Socket.on('data', (data) => {
        log.info(`H02: server response: ${data.toString().trim()}`);
    });

    h02Socket.on('error', (err) => {
        log.error(`H02: socket error: ${err.message}`);
        h02Connected = false;
    });

    h02Socket.on('close', () => {
        log.info('H02: connection closed, reconnecting in 10s');
        h02Connected = false;
        setTimeout(h02Connect, 10000);
    });
}

// Convert decimal degrees to DDMM.MMMM format
function toNMEA(degrees, isLat) {
    const d = Math.abs(degrees);
    const deg = Math.floor(d);
    const min = (d - deg) * 60;
    const pad = isLat ? 2 : 3;
    return `${String(deg).padStart(pad, '0')}${min.toFixed(4).padStart(7, '0')}`;
}

function buildH02Packet(tpv, sky) {
    const now = new Date(tpv.time);
    const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14); // HHMMSS
    const date = now.toISOString().slice(8,10) + now.toISOString().slice(5,7) + now.toISOString().slice(2,4); // DDMMYY

    const lat = toNMEA(tpv.lat, true);
    const latDir = tpv.lat >= 0 ? 'N' : 'S';
    const lon = toNMEA(tpv.lon, false);
    const lonDir = tpv.lon >= 0 ? 'E' : 'W';
    const speed = (tpv.speed * 1.94384).toFixed(2); // m/s to knots
    const course = (tpv.track || 0).toFixed(0);

    return `*HQ,${config.device_id},V1,${time},A,${lat},${latDir},${lon},${lonDir},${speed},${course},${date},FFFFFBFF#\r\n`;
}

// --- send ---

let previousSendTime = 0;
let hasExceededStaticDistance = false;
let toSend = [];

const delayTimer = 10000;
const loopTimer = 1000;

if (protocol === PROTOCOL_H02) {
    h02Connect();
}

checkInterval();
function checkInterval(){
    log.debug("call checkInterval()");
    log.debug(`historicTPV.length = ${historicTPV.length}`);
    if(historicTPV.length > 1){
        let totalDistance = 0;

        let first = historicTPV[0];
        let last = historicTPV[historicTPV.length-1];

        const a = { lat: first.lat, lon: first.lon }
        const b = { lat: last.lat, lon: last.lon }
        totalDistance = haversine(a, b);

        if(totalDistance > config.static_distance_threshold){
            hasExceededStaticDistance = true;
        }
    }

    log.debug(`hasExceededStaticDistance = ${hasExceededStaticDistance}`);
    var waitTime = hasExceededStaticDistance ? config.send_interval : config.static_send_interval;
    log.debug(`waitTime = ${waitTime}`);

    log.debug(`previousSendTime = ${previousSendTime}`);
    log.debug(`Date.now() - waitTime = ${Date.now() - waitTime}`);
    if(previousSendTime < Date.now() - waitTime){
        log.debug(`Send time has elapsed!`);
        if(cachedTPV != null && (cachedTPV.lat !== 0 &&  cachedTPV.lon !== 0)){
            saveLocation();
            hasExceededStaticDistance = false;
            previousSendTime = Date.now();
        }
        else{
            log.info(`Send time has elapsed but waiting for fix.. ${cachedSKY == null ? 'no data yet' : `satellite count = ${cachedSKY.satellites.length}` }, last GPSD update ${lastMessageTime}`);
        }
    }

    sendMessages().then(() => {
        setTimeout(checkInterval, cachedTPV != null ? loopTimer : delayTimer);
    });
}

function saveLocation(){
    if (protocol === PROTOCOL_H02) {
        toSend.push({ type: PROTOCOL_H02, packet: buildH02Packet(cachedTPV, cachedSKY) });
    } else {
        let lat = cachedTPV.lat;
        let lon = cachedTPV.lon;
        let speed = cachedTPV.speed;
        let hdop = cachedSKY.hdop;
        let time = cachedTPV.time;
        let epx = cachedTPV.epx;
        let epy = cachedTPV.epy;
        let accuracy = (epx + epy)/2;
        let url = `${config.server_url}/?id=${config.device_id}&lat=${lat}&lon=${lon}&hdop=${hdop}&speed=${speed}&timestamp=${time}&accuracy=${Math.round(accuracy * 100) / 100}`;
        toSend.push({ type: PROTOCOL_OSMAND, url });
    }
}

async function sendMessages(){
    while(toSend.length > 0){
        const msg = toSend[0];
        try {
            if (msg.type === PROTOCOL_H02) {
                if (!h02Connected) {
                    log.info(`H02: not connected, ${toSend.length} update(s) queued`);
                    break;
                }
                log.info(`H02: sending '${msg.packet.trim()}'`);
                await new Promise((resolve, reject) => {
                    h02Socket.write(msg.packet, (err) => err ? reject(err) : resolve());
                });
            } else if (msg.type === PROTOCOL_OSMAND) { {
                log.info(`HTTP: sending '${msg.url}', last GPSD update ${lastMessageTime}`);
                await new Promise((resolve, reject) => {
                    http.get(msg.url, (res) => {
                        res.resume();
                        resolve();
                    }).on('error', reject);
                });
            }
            log.info("success");
            toSend.shift();
        }
        catch(e){
            log.error(`FAILED TO UPDATE LOCATION, #${toSend.length} UPDATES IN QUEUE`, e);
            if (msg.type === PROTOCOL_H02) {
                h02Connected = false;
                h02Socket.destroy();
            }
            break;
        }
    }
}
