FROM: termux
TIME: 2026-07-27 19:16:25
CMD: cd ~/eon-cloud-agent && git pull origin main && cp eon_matrix_intelligence.py /root/eon_matrix_intelligence.py && chmod +x /root/eon_matrix_intelligence.py && cp eon_github_relay.py /root/eon_github_relay.py && python3 /root/eon_matrix_intelligence.py status && echo 'Matrix Intelligence deployed on Ubuntu'