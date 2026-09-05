export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { smc } = req.body;

    if (!smc) {
      return res.status(400).json({
        success: false,
        error: "Missing SMC data"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is not configured"
      });
    }

    const prompt = `
You are an expert trading market analyst.

Analyze the following SMC Analyzer V4 data for XAU/USD.

IMPORTANT:
- Do not invent market data.
- Use only the information provided.
- Treat the SMC signal as an analysis, not a guaranteed prediction.
- If the setup is weak or conflicting, prefer WAIT.
- Give a clear final decision: BUY, SELL, or WAIT.

SMC DATA:
${JSON.stringify(smc, null, 2)}

Return ONLY valid JSON in this exact structure:

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
        error: "Gemini returned no text",
        raw: data
      });
    }

    let analysis;

    try {
      analysis = JSON.parse(text);
    } catch {
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
        warnings: ["Gemini returned invalid JSON"],
        analysis: text
      };
    }

    return res.status(200).json({
      success: true,
      analyzer: "SMC Analyzer V4 + Gemini",
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
