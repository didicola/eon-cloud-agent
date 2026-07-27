FROM: termux
TIME: 2026-07-27 19:11:38
CMD: cd ~/eon-cloud-agent && git pull origin main && cp eon_matrix_intelligence.py /root/eon_matrix_intelligence.py && chmod +x /root/eon_matrix_intelligence.py && echo '=== Matrix Intelligence Upgraded ===' && python3 /root/eon_matrix_intelligence.py status && export EON_TIER=pro-max && echo 'Done'