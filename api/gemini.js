export default async function handler(req, res) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is not configured"
      });
    }

    // Get SMC V4 analysis automatically
    const baseUrl = `https://${req.headers.host}`;
    const smcResponse = await fetch(
      `${baseUrl}/api/analyze-v4`
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
You are an expert Smart Money Concepts (SMC) trading analyst.

Analyze this XAU/USD SMC V4 data.

IMPORTANT:
- Use ONLY the provided data.
- Do not invent prices or market conditions.
- Do not guarantee a profitable trade.
- If the setup has conflicts or lacks confirmation, choose WAIT.
- Final signal must be BUY, SELL, or WAIT.
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
  "analysis": "short professional explanation"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Gemini API error",
        details: data
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned no response",
        raw: data
      });
    }

    let analysis;

    try {
      analysis = JSON.parse(text);
    } catch {
      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid JSON",
        raw: text
      });
    }

    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → Gemini",
      smcVersion: "4.0",
      symbol: "XAU/USD",
      analysis
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
        }
