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

client.on('TPV', data => {
    //first check mode, 1 = no fix, 2 = 2d fix, 3 = 3d fix
    if(data.mode > 1 && data.device == config.gps_device){
        previousTPV = cachedTPV;
        cachedTPV = data;
    }
    else{
        console.log("Waiting for fix...");
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

checkInterval();
function checkInterval(){
    if(cachedTPV != null && previousTPV != null){
        const a = { lat: cachedTPV.lat, lon: cachedTPV.lon }
        const b = { lat: previousTPV.lat, lon: previousTPV.lon }
        let distance = haversine(a, b);
        
        if(distance > config.static_distance_threshold){
            hasExceededStaticDistance = true;
        }
        
        var waitTime = hasExceededStaticDistance ? config.send_interval : config.static_send_interval;
        if(previousSendTime < Date.now() - waitTime){
            saveLocation();
            hasExceededStaticDistance = false;
            previousSendTime = Date.now();
        }
        
    }
    sendMessages();
    setTimeout(checkInterval, 1000);
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
            await tiny.get({url});
            console.log("Location updated successfully")
            toSend.shift()
        }
        catch(e){
            console.error(`FAILED TO UPDATE LOCATION, #${toSend.length} UPDATES IN QUEUE`, e);
            break;
        }
    }
}