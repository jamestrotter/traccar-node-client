# traccar-node-client
A node client for pushing GPS updates from GPSD to a Traccar server

This will cache updates when they fail to send, meaning full history is retained when tracking resumes.

# example config.json

    {
        "gps_device": "/dev/ttyACM0",
        "gpsd_host": "localhost",
        "gpsd_port": 2947,
        "send_interval": 20000,
        "static_send_interval": 60000,
        "static_distance_threshold": 1,
        "server_url": "http://localhost:5055",
        "device_id": 7812
    }

Config Options:
- `"gps_device"` - the device reported by GPSD
- `"gpsd_host"` - hostname/ip/url of machine running GPSD
- `"gpsd_port"` - GPSD port
- `"send_interval"` - interval between sending when not static (i.e in motion)
- `"static_send_interval"` - interval between sending when static (i.e not in motion)
- `"static_distance_threshold"` - distance in meters between GPS updates reported from GPSD to be classed as not "static"
- `"static_distance_measure_time"` - the number of milliseconds worth of GPSD updates to use to calculate distance moved. the default values of 1m & 1000ms equates to ~2mph.
- `"server_url"` - traccar server url (inc. port) for OsmAnd updates
- `"device_id"` - Device ID to send to traccar

