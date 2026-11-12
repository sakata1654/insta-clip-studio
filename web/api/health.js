/**
 * GET /api/health
 * Reports which server-side AI / ASR providers are configured via Vercel Environment Variables.
 * Never returns secret values.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const allowByok = process.env.WEB_ALLOW_BYOK !== 'false';
  return res.status(200).json({
    ok: true,
    runtime: 'vercel-serverless',
    allowByok,
    maxUploadBytes: 4_200_000,
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
    },
  });
}
