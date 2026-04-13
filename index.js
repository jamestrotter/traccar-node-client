const Gpsd = require('node-gpsd-client');
const http = require('http');
const haversine = require("haversine-distance");
const { EOL } = require("os");

let config = null;
try{
    config = require('./config.json');
}
catch (e){
    throw new Error("FAILED TO LOAD config.json FILE" +  EOL + e);
}

const client = new Gpsd({
  port: config.gpsd_port,
  hostname: config.gpsd_host,
  parse: true
})

client.on('connected', () => {
    console.log('Gpsd connected')
    client.watch({
        class: 'WATCH',
        json: true,
        scaled: true
    })
})

client.on('error', err => {
    console.log(`Gpsd error: ${err.message}`)
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

let previousSendTime = 0;
let hasExceededStaticDistance = false;
let toSend = [];

const delayTimer = 10000;
const loopTimer = 1000;

checkInterval();
function checkInterval(){
    console.log("call checkInterval()");
    console.log(`historicTPV.length = ${historicTPV.length}`);
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

    console.log(`hasExceededStaticDistance = ${hasExceededStaticDistance}`);
    var waitTime = hasExceededStaticDistance ? config.send_interval : config.static_send_interval;
    console.log(`waitTime = ${waitTime}`);

    console.log(`previousSendTime = ${previousSendTime}`);
    console.log(`Date.now() - waitTime = ${Date.now() - waitTime}`);
    if(previousSendTime < Date.now() - waitTime){
        console.log(`Send time has elapsed!`);
        if(cachedTPV != null && (cachedTPV.lat !== 0 &&  cachedTPV.lon !== 0)){
            saveLocation();
            hasExceededStaticDistance = false;
            previousSendTime = Date.now();
        }
        else{
            console.log(`Send time has elapsed but waiting for fix.. ${cachedSKY == null ? 'no data yet' : `satellite count = ${cachedSKY.satellites.length}` }, last GPSD update ${lastMessageTime}`);
        }
    }

    sendMessages().then(() => {
        setTimeout(checkInterval, cachedTPV != null ? loopTimer : delayTimer);
    });
}

function saveLocation(){
    
    let lat = cachedTPV.lat;
    let lon = cachedTPV.lon;
    let speed = cachedTPV.speed;    
    let hdop = cachedSKY.hdop;
    let time = cachedTPV.time;
    let epx = cachedTPV.epx;
    let epy = cachedTPV.epy;
    let accuracy = (epx + epy)/2

    let url = `${config.server_url}/?id=${config.device_id}&lat=${lat}&lon=${lon}&hdop=${hdop}&speed=${speed}&timestamp=${time}&accuracy=${Math.round(accuracy * 100) / 100}`;
    toSend.push(url);
}

async function sendMessages(){
    while(toSend.length > 0){
        var url = toSend[0];
        try {
            console.log(`sending '${url}', last GPSD update ${lastMessageTime}`);
            await new Promise((resolve, reject) => {
                http.get(url, (res) => {
                    res.resume();
                    resolve();
                }).on('error', reject);
            });
            console.log("success");
            toSend.shift();
        }
        catch(e){
            console.error(`FAILED TO UPDATE LOCATION, #${toSend.length} UPDATES IN QUEUE`, e);
            break;
        }
    }
}
