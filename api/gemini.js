export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY is not configured"
      });
    }

    // Get SMC V4 automatically
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

    const prompt = `
You are a professional Smart Money Concepts (SMC) trading analyst.

Analyze the following XAU/USD 5-minute SMC V4 data.

RULES:
- Use ONLY the supplied data.
- Do not invent market information.
- Do not guarantee profit.
- If signals conflict, prefer WAIT.
- Absence of displacement is a warning.
- Consider BOS, CHOCH, liquidity sweep, FVG, Order Block and Premium/Discount.
- Be conservative.

SMC V4 DATA:
${JSON.stringify(smc, null, 2)}

Return ONLY valid JSON:

{
  "signal": "BUY | SELL | WAIT",
  "confidence": 0,
  "bias": "BULLISH | BEARISH | NEUTRAL",
  "market_quality": "A | B | C | D",
  "entry": null,
  "stop_loss": null,
  "take_profit": null,
  "risk_reward": null,
  "reasons": [],
  "warnings": [],
  "analysis": ""
}
`;

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
          temperature: 0.2
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "OpenRouter API error",
        details: data
      });
    }

    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter returned no response",
        raw: data
      });
  
    let analysis;

try {
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }

  analysis = JSON.parse(cleaned);

} catch (error) {
  return res.status(200).json({
    success: true,
    system: "XAU/USD → Twelve Data → SMC V4 → OpenRouter",
    model: "openrouter/free",
    ai_raw_response: text,
    analysis: {
      signal: "WAIT",
      confidence: 0,
      bias: "NEUTRAL",
      market_quality: "D",
      entry: null,
      stop_loss: null,
      take_profit: null,
      risk_reward: null,
      reasons: [],
      warnings: ["AI response could not be parsed as JSON"],
      analysis: text
    }
  });
}
      analysis = {
        signal: "WAIT",
        confidence: 0,
        bias: "NEUTRAL",
        market_quality: "D",
        entry: null,
        stop_loss: null,
        take_profit: null,
        risk_reward: null,
        reasons: [],
        warnings: ["AI returned invalid JSON"],
        analysis: text
      };
    }

    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → OpenRouter",
      model: "openrouter/free",
      timestamp: new Date().toISOString(),
      analysis
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
