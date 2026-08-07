FROM: cloud
TO: termux
ACTION: CMD
CMD: echo T1-ALIVE $(hostname) $(date -u) && curl -s -m 10 https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/sync/memory?limit=2 -o /dev/null -w 'net: