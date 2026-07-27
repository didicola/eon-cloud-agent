// EON Telegram Bot Cloudflare Worker - Cloud Native
// No local machine dependency. Runs entirely on Cloudflare.
// Uses cloud-brain-proxy as primary (no rebalancing errors)

const CLOUD_BRAIN = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const VERSION = '5.0-universal';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Webhook endpoint for Telegram
    if (url.pathname === '/webhook') {
      const update = await request.json();
      await handleUpdate(update);
      return new Response('OK');
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({status: 'ok', version: VERSION}));
    }
    
    // Force set webhook
    if (url.pathname === '/set-webhook') {
      const webhookUrl = url.searchParams.get('url') || `${url.origin}/webhook`;
      const r = await tgApi('setWebhook', {url: webhookUrl});
      return new Response(JSON.stringify(r));
    }
    
    return new Response('EON Telegram Bot Worker');
  }
};

async function tgApi(method, data) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  return r.json();
}

async function callBrain(prompt) {
  // Only use cloud-brain - never eon-p2p (avoids rebalancing error)
  const r = await fetch(`${CLOUD_BRAIN}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BRAIN_TOKEN}`
    },
    body: JSON.stringify({
      model: 'cloud-brain-proxy/sovereign-cloud',
      messages: [{role: 'user', content: prompt}],
      max_tokens: 2000
    })
  });
  const data = await r.json();
  if (data.choices && data.choices[0]) {
    return data.choices[0].message.content;
  }
  return `[cloud-brain] ${JSON.stringify(data).slice(0, 300)}`;
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Only respond to our chat
  if (chatId != CHAT_ID) return;
  
  // Show typing
  await tgApi('sendChatAction', {chat_id: chatId, action: 'typing'});
  
  let response;
  
  if (text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    if (cmd === '/start' || cmd === '/help') {
      response = `🧠 EON Universal AI Brain v${VERSION}\nCloud-native Telegram Bot\n\nSend any message to chat. Commands:\n/explain <q> - chain-of-thought\n/version - system version\n/models - available models`;
    } else if (cmd === '/version') {
      response = `EON Universal AI Brain v${VERSION}\nDeployed on Cloudflare Workers\nCloud-native, no local machine dependency`;
    } else if (cmd === '/models') {
      response = 'Cloud Brain: sovereign-cloud\nEON P2P: 35 models (via direct API)\nTotal: 39 models across 8 workers';
    } else if (cmd === '/explain') {
      const prompt = text.slice(8).trim();
      if (!prompt) response = 'Usage: /explain <question>';
      else response = await callBrain(`[EXPLAIN] ${prompt}`);
    } else {
      response = await callBrain(text);
    }
  } else {
    response = await callBrain(text);
  }
  
  await tgApi('sendMessage', {
    chat_id: chatId,
    text: response.slice(0, 4000)
  });
}
