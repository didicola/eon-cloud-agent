# OpenCode Twin — Step 4 Delivery

## Status: DELIVERED ✅ (2026-07-31)

The full opencode core + architecture + DNA has been delivered to **AI Cloud** and is available to **AI Web** and **termux (node 5)**.

## Where the DNA lives

| Location | ID | Content |
|----------|-----|---------|
| AI Cloud D1 (ai-cloud-space) | ns=twins, key=opencode-twin-v1 | TWIN_MANIFEST.json (2724 bytes) |
| AI Cloud D1 (ai-cloud-space) | ns=twins, key=opencode-twin-bundle-v1 | FULL DNA bundle (130 files, 1.9MB) |
| GitHub repo | twin/TWIN_MANIFEST.json | Manifest for AI Web + termux |
| Local (ubuntu) | /home/ricos/opencode-twin/ | Full source bundle |

## What the twin must do (per didicola step 4)

1. AI Cloud / AI Web: **create your OWN twin** using this DNA
2. Give it **your own domain**
3. **Resend the new twin** here for install
4. It will be **free forever**

## Access

- Read manifest: GET https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev/d1/twins/opencode-twin-v1 (Bearer AI_SPACE_TOKEN)
- Read full bundle: GET https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev/d1/twins/opencode-twin-bundle-v1
- GitHub: twin/ dir in didicola/eon-cloud-agent
