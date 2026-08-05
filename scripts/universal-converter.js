// universal-converter.js — regenerated EON provider-format conversion library
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const PROVIDER_FORMATS = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  mistral: 'openai',
  ollama: 'openai',
  groq: 'openai',
  deepinfra: 'openai',
  together: 'openai',
  hf: 'openai',
  cohere: 'cohere',
  bedrock: 'bedrock',
  vertex: 'google'
};

function detectResponseFormat(body) {
  if (!body) return 'openai';
  const s = String(body);
  if (s.includes('"content":[{"type":"text"') || s.includes('"content":[{"candidates"')) return 'google';
  if (s.includes('"content":[{"type":"text"') && s.includes('"role"') === false) return 'anthropic';
  if (s.includes('"choices"')) return 'openai';
  return 'openai';
}

// Convert an OpenAI-style payload to the target provider format.
function fromOpenAI(payload, targetFormat) {
  const fmt = targetFormat || 'openai';
  const p = JSON.parse(JSON.stringify(payload || {}));
  if (fmt === 'openai') return p;

  if (fmt === 'anthropic') {
    const system = (p.messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n');
    const rest = (p.messages || []).filter(m => m.role !== 'system');
    const content = rest.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || ''
    }));
    const out = {
      model: p.model, max_tokens: p.max_tokens || 4096, messages: content, stream: p.stream || false
    };
    if (system) out.system = system;
    if (p.temperature !== undefined) out.temperature = p.temperature;
    return out;
  }

  if (fmt === 'google') {
    const contents = (p.messages || []).filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    }));
    const out = {
      contents,
      generationConfig: {}
    };
    if (p.max_tokens) out.generationConfig.maxOutputTokens = p.max_tokens;
    if (p.temperature !== undefined) out.generationConfig.temperature = p.temperature;
    const system = (p.messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n');
    if (system) out.systemInstruction = { parts: [{ text: system }] };
    return out;
  }

  if (fmt === 'cohere') {
    const last = (p.messages || []).pop();
    return {
      model: p.model, message: last?.content || '', max_tokens: p.max_tokens || 4096,
      chat_history: (p.messages || []).map(m => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content || '' }))
    };
  }

  if (fmt === 'bedrock') {
    return {
      modelId: p.model,
      messages: (p.messages || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'text', text: m.content || '' }] })),
      inferenceConfig: { maxTokens: p.max_tokens || 4096, temperature: p.temperature }
    };
  }

  return p;
}

// Convert a provider-format response back to OpenAI format.
function toOpenAI(providerFormat, body) {
  const fmt = providerFormat || 'openai';
  let parsed = body;
  if (typeof body === 'string') { try { parsed = JSON.parse(body); } catch (e) { return body; } }
  if (fmt === 'openai') return parsed;

  if (fmt === 'google' || fmt === 'vertex') {
    try {
      const candidates = parsed?.candidates || [];
      const text = candidates.map(c => c?.content?.parts?.map(pt => pt?.text || '').join('') || '').join('');
      return {
        id: 'google-' + Date.now(), object: 'chat.completion', model: parsed?.model || 'gemini',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: parsed?.usageMetadata || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    } catch (e) { return parsed; }
  }

  if (fmt === 'anthropic') {
    try {
      const text = parsed?.content?.map(c => typeof c === 'string' ? c : c?.text || '').join('') || '';
      return {
        id: 'anthropic-' + Date.now(), object: 'chat.completion', model: parsed?.model || 'claude',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: parsed?.usage?.input_tokens || 0, completion_tokens: parsed?.usage?.output_tokens || 0, total_tokens: (parsed?.usage?.input_tokens || 0) + (parsed?.usage?.output_tokens || 0) }
      };
    } catch (e) { return parsed; }
  }

  if (fmt === 'cohere') {
    try {
      return {
        id: 'cohere-' + Date.now(), object: 'chat.completion', model: parsed?.model || 'cohere',
        choices: [{ index: 0, message: { role: 'assistant', content: parsed?.text || parsed?.message?.content || '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    } catch (e) { return parsed; }
  }

  return parsed;
}

function normalizeResponse(body, providerFormat) {
  const fmt = detectResponseFormat(body);
  return toOpenAI(fmt, body);
}

module.exports = { normalizeResponse, fromOpenAI, toOpenAI, PROVIDER_FORMATS, detectResponseFormat };
