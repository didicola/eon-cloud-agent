#!/bin/bash
# Submit a task to the 7000 Agent Swarm
if [ -z "$1" ]; then
    echo "Usage: eon-swarm <task description>"
    echo "Example: eon-swarm 'write a python script that counts to 10'"
    exit 1
fi
python3 /home/ricos/eon-cloud-agent/eon_swarm_7000.py --workers 5 "$@" 2>&1
