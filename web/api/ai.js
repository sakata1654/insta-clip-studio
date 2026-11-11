/**
 * POST /api/ai
 * Secure server-side proxy for Gemini, OpenAI, OpenRouter, Groq, or Anthropic JSON/text calls.
 * Keeps platform API keys in Vercel env vars; supports optional BYOK fallback if WEB_ALLOW_BYOK !== 'false'.
 */
const ALLOWED_BASE_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'openrouter.ai',
]);

function safeCustomBaseUrl(prov, rawUrl) {
  const defaults = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
  };
  const fallback = defaults[prov] || defaults.gemini;
  if (!rawUrl) return fallback;
  try {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:' || !ALLOWED_BASE_HOSTS.has(u.hostname)) return fallback;
    return String(rawUrl).replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const prov = String(body?.prov || 'gemini').toLowerCase();
  const model = String(body?.model || '').trim() || (prov === 'gemini' ? 'gemini-2.5-flash' : prov === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini');
  const prompt = String(body?.prompt || '');
  const systemMsg = String(body?.systemMsg || '');
  const temp = Number.isFinite(+body?.temp) ? Math.min(1.5, Math.max(0, +body.temp)) : 0.15;
  const expectJson = body?.expectJson !== false;

  if (!prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is empty' });
  }

  const allowByok = process.env.WEB_ALLOW_BYOK !== 'false';
  const userKey = allowByok ? String(req.headers['x-user-api-key'] || '').trim() : '';
  const serverKey =
    prov === 'gemini'
      ? process.env.GEMINI_API_KEY
      : prov === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : prov === 'groq'
          ? process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY
          : process.env.OPENAI_API_KEY;

  const apiKey = userKey || serverKey || '';
  if (!apiKey) {
    return res.status(401).json({
      code: 'NO_API_KEY',
      error: `No API key configured for "${prov}". Add ${prov.toUpperCase()}_API_KEY in Vercel or enable your own key in Settings.`,
    });
  }

  const base = safeCustomBaseUrl(prov, body?.url);

  try {
    let txt = '';
    if (prov === 'gemini' && !/\/openai$/.test(base)) {
      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: temp,
          ...(expectJson ? { responseMimeType: 'application/json' } : {}),
        },
        safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({
          category: 'HARM_CATEGORY_' + c,
          threshold: 'BLOCK_ONLY_HIGH',
        })),
      };
      if (systemMsg) payload.systemInstruction = { parts: [{ text: systemMsg }] };
      const r = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: j?.error?.message || `Gemini HTTP ${r.status}` });
      }
      if (j.promptFeedback?.blockReason) {
        return res.status(400).json({ error: 'Blocked by Gemini: ' + j.promptFeedback.blockReason });
      }
      txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    } else if (prov === 'anthropic') {
      const payload = {
        model,
        max_tokens: 8000,
        temperature: temp,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemMsg) payload.system = systemMsg;
      const r = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: j?.error?.message || `Anthropic HTTP ${r.status}` });
      }
      txt = (j.content || []).map((c) => c.text || '').join('');
    } else {
      const messages = systemMsg
        ? [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: temp, messages }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: j?.error?.message || `OpenAI HTTP ${r.status}` });
      }
      txt = j.choices?.[0]?.message?.content || '';
    }

    if (!txt) return res.status(502).json({ error: 'AI provider returned empty output' });
    return res.status(200).json({ text: txt });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
