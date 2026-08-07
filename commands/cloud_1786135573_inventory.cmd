FROM: cloud-controller
TO: cloud
ACTION: CMD
CMD: echo '=== CLOUD INVENTORY ==='; echo '-- python --'; python3 -V; echo '-- torch --'; python3 -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())" 2>&1 | head -1; echo '-- transformers/hf --'; python3 -c "import transformers; print('transformers', transformers.__version__)" 2>&1 | head -1; echo '-- node --'; node -v; echo '-- wrangler --'; npx wrangler --version 2>&1 | tail -1; echo '-- hf env --'; env | grep -iE 'HF_|HUGGING|OPENROUTER|CEREBRAS|SAMBANOVA|EON_' | sed 's/=.*/=<set>/' | head; echo '-- blind-proxy --'; ls -la blind-proxy.js 2>/dev/null; echo '-- whoami --'; whoami; echo '-- outbound internet --'; curl -s -m8 https://api.github.com/zen && echo; echo '-- cloudflare workers reachable --'; curl -s -m8 -o /dev/null -w 'eon-p2p:%{http_code}
' https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/; curl -s -m8 -o /dev/null -w 'brain-proxy:%{http_code}
' https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/
ACK: yes
