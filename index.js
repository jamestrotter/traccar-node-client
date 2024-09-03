const Gpsd = require('node-gpsd-client');
const tiny = require('tiny-json-http');
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
let previousTPV = null;
let cachedTPV = null;
let lastMessageTime = new Date(0);

client.on('TPV', data => {
    //first check mode, 1 = no fix, 2 = 2d fix, 3 = 3d fix]
    if(data.device == config.gps_device){
        lastMessageTime = new Date(Date.now());
        if(data.mode > 1){
            previousTPV = cachedTPV;
            cachedTPV = data;
        }
        else{
            cachedTPV = null;
            previousTPV= null;
        }
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

    if(cachedTPV != null && previousTPV != null){
        const a = { lat: cachedTPV.lat, lon: cachedTPV.lon }
        const b = { lat: previousTPV.lat, lon: previousTPV.lon }
        let distance = haversine(a, b);

        if(distance > config.static_distance_threshold){
            hasExceededStaticDistance = true;
        }
    }

    var waitTime = hasExceededStaticDistance ? config.send_interval : config.static_send_interval;
    if(previousSendTime < Date.now() - waitTime){
        if(cachedTPV != null){
            saveLocation();
            hasExceededStaticDistance = false;
            previousSendTime = Date.now();
        }
        else{
            console.log(`Send time has elapsed but waiting for fix.. ${cachedSKY == null ? 'no data yet' : `satellite count = ${cachedSKY.satellites.length}` }, last GPSD update ${lastMessageTime}`);
        }
    }

    sendMessages();
    setTimeout(checkInterval, cachedTPV != null ? loopTimer : delayTimer);
}

function saveLocation(){
    
    let lat = cachedTPV.lat;
    let lon = cachedTPV.lon;
    let speed = cachedTPV.speed;    
    let hdop = cachedSKY.hdop;
    let time = cachedTPV.time;

    let url = `${config.server_url}/?id=${config.device_id}&lat=${lat}&lon=${lon}&hdop=${hdop}&speed=${speed}&timestamp=${time}`;
    toSend.push(url);
}

async function sendMessages(){
    while(toSend.length > 0){
        var url = toSend[0];
        try {
            console.log(`sending '${url}', last GPSD update ${lastMessageTime}`);
            await tiny.get({url});
            console.log("success");
            toSend.shift();
        }
        catch(e){
            console.error(`FAILED TO UPDATE LOCATION, #${toSend.length} UPDATES IN QUEUE`, e);
            break;
        }
    }
}