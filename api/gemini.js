export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY is not configured"
      });
    }

    // ==============================
    // 1. Get SMC V4 automatically
    // ==============================

    const host = req.headers.host;

    const smcResponse = await fetch(
      `https://${host}/api/analyze-v4`
    );

    const smc = await smcResponse.json();

    if (!smcResponse.ok || !smc.success) {
      return res.status(500).json({
        success: false,
        error: "SMC V4 analysis failed",
        details: smc
      });
    }

    // ==============================
    // 2. Prompt
    // ==============================

    const prompt = `
You are an expert Smart Money Concepts trading analyst.

Analyze this XAU/USD 5-minute SMC V4 data.

IMPORTANT RULES:

- Use ONLY the data provided.
- Never invent market data.
- Never guarantee profit.
- If the setup is conflicting or weak, choose WAIT.
- Absence of displacement is a warning.
- Consider BOS, CHOCH, liquidity sweep, FVG, Order Block and Premium/Discount.
- Be conservative.
- This is analysis for research/testing, not financial advice.

SMC V4 DATA:

${JSON.stringify(smc, null, 2)}

Give a professional trading analysis.

Your answer MUST contain:

SIGNAL: BUY, SELL, or WAIT

CONFIDENCE: number from 0 to 100

BIAS: BULLISH, BEARISH, or NEUTRAL

MARKET QUALITY: A, B, C, or D

ENTRY: price or N/A

STOP LOSS: price or N/A

TAKE PROFIT: price or N/A

RISK REWARD: number or N/A

REASONS:
- reason 1
- reason 2
- reason 3

WARNINGS:
- warning 1
- warning 2

ANALYSIS:
A short professional explanation of the setup.
`;

    // ==============================
    // 3. OpenRouter
    // ==============================

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://smc-claude-webhook.vercel.app",
          "X-Title": "SMC V4 Analyzer"
        },

        body: JSON.stringify({
          model: "openrouter/free",

          messages: [
            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0.2,

          max_tokens: 1000
        })
      }
    );

    const data = await response.json();

    // ==============================
    // 4. OpenRouter error
    // ==============================

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "OpenRouter API error",
        details: data
      });
    }

    // ==============================
    // 5. Extract AI response
    // ==============================

    const text =
      data?.choices?.[0]?.message?.content;

    if (!text) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter returned no text",
        raw: data
      });
    }

    // ==============================
    // 6. Try JSON first
    // ==============================

    let parsed = null;

    try {
      let cleaned = text.trim();

      cleaned = cleaned
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");

      if (start !== -1 && end !== -1 && end > start) {
        const jsonText = cleaned.substring(
          start,
          end + 1
        );

        parsed = JSON.parse(jsonText);
      }
    } catch (error) {
      parsed = null;
    }

    // ==============================
    // 7. If JSON worked
    // ==============================

    if (parsed) {
      return res.status(200).json({
        success: true,

        system:
          "XAU/USD → Twelve Data → SMC V4 → OpenRouter",

        model:
          data?.model || "openrouter/free",

        timestamp:
          new Date().toISOString(),

        analysis: parsed
      });
    }

    // ==============================
    // 8. If NOT JSON
    // Return the raw AI text
