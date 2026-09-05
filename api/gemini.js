export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY is missing"
      });
    }

    // SMC V4 endpoint
    const smcUrl = "https://smc-claude-webhook.vercel.app/api/analyze-v4";

    const smcResponse = await fetch(smcUrl);

    const smcRaw = await smcResponse.text();

    if (!smcResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "SMC V4 request failed",
        status: smcResponse.status,
        details: smcRaw
      });
    }

    let smcData;

    try {
      smcData = JSON.parse(smcRaw);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "SMC V4 did not return valid JSON",
        details: smcRaw.substring(0, 1000)
      });
    }

    // Send SMC analysis to OpenRouter
    const prompt = `
You are a professional Smart Money Concepts (SMC) trading analyst.

Analyze the following XAU/USD 5-minute SMC data:

${JSON.stringify(smcData, null, 2)}

IMPORTANT RULES:

1. Be conservative.
2. Never guarantee profit.
3. Do not invent market data.
4. If the setup is unclear, return WAIT.
5. Consider structure, BOS, CHOCH, liquidity sweep, displacement, FVG, Order Block and Premium/Discount.
6. A liquidity sweep alone is NOT enough for a trade.
7. If displacement is false, reduce confidence.
8. If BUY and SELL evidence are close, prefer WAIT.
9. Only provide an entry, stop loss and take profit when a valid setup exists.
10. Use the exact price levels available in the SMC data when possible.

Return ONLY this format:

SIGNAL: BUY / SELL / WAIT
CONFIDENCE: 0-100
BIAS: BULLISH / BEARISH / NEUTRAL
MARKET QUALITY: A / B / C / D
ENTRY: price or NONE
STOP LOSS: price or NONE
TAKE PROFIT: price or NONE
RISK REWARD: value or NONE

REASONS:
- reason
- reason
- reason

WARNINGS:
- warning
- warning

ANALYSIS:
short professional explanation
`;

    const aiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://smc-claude-webhook.vercel.app",
          "X-Title": "SMC Analyzer"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            {
              role: "system",
              content:
                "You are a conservative professional SMC trading analyst. Follow the requested output format exactly."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 1200
        })
      }
    );

    const aiRaw = await aiResponse.text();

    if (!aiResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter request failed",
        status: aiResponse.status,
        details: aiRaw
      });
    }

    let aiData;

    try {
      aiData = JSON.parse(aiRaw);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter returned invalid JSON",
        details: aiRaw.substring(0, 2000)
      });
    }

    const message = aiData?.choices?.[0]?.message;
    let analysis = message?.content;

    // Handle different possible OpenRouter content formats
    if (Array.isArray(analysis)) {
      analysis = analysis
        .map(item => {
          if (typeof item === "string") return item;
          return item?.text || "";
        })
        .join("\n");
    }

    if (analysis !== null && analysis !== undefined) {
      analysis = String(analysis);
    }

    if (!analysis || !analysis.trim()) {
      return res.status(500).json({
        success: false,
        error: "AI returned empty analysis",
        raw: aiData
      });
    }

    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → OpenRouter",
      model: "openrouter/free",
      timestamp: new Date().toISOString(),

      signal_source: {
        analyzer: "SMC Analyzer V4",
        timeframe: "5min"
      },

      smc: smcData,

      analysis: analysis.trim(),

      disclaimer:
        "Algorithmic SMC analysis for research and backtesting only. Not financial advice."
    });

  } catch (error) {
    console.error("SMC AI ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error?.message || String(error)
    });
  }
}
