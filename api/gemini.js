export default async function handler(req, res) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is not configured"
      });
    }

    // 1. Get SMC V4 automatically
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

    // 2. Prepare Gemini prompt
    const prompt = `
You are a professional Smart Money Concepts (SMC) market analyst.

Analyze the following XAU/USD 5-minute SMC V4 data.

RULES:
1. Use ONLY the provided data.
2. Never invent prices or market conditions.
3. Do not guarantee profit.
4. If signals conflict, choose WAIT.
5. Lack of displacement is a warning.
6. Premium/Discount must be considered.
7. Consider BOS, CHOCH, liquidity sweep, FVG and Order Block together.
8. Be conservative.
9. Final decision must be BUY, SELL, or WAIT.

SMC V4 DATA:
${JSON.stringify(smc, null, 2)}

Return ONLY valid JSON using this structure:

{
  "signal": "BUY",
  "confidence": 0,
  "bias": "BULLISH",
  "market_quality": "A",
  "entry": null,
  "stop_loss": null,
  "take_profit": null,
  "risk_reward": null,
  "reasons": [],
  "warnings": [],
  "analysis": ""
}
`;

    // 3. Send SMC data to Gemini
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        success: false,
        error: "Gemini API error",
        details: data
      });
    }

    // 4. Get Gemini response
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned no response",
        raw: data
      });
    }

    // 5. Parse JSON
    let analysis;

    try {
      analysis = JSON.parse(text);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid JSON",
        raw: text
      });
    }

    // 6. Final response
    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → Gemini",
      model: "gemini-3.6-flash",
      timestamp: new Date().toISOString(),
      smc: smc,
      analysis: analysis
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
