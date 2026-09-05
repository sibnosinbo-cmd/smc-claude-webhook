export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY is missing"
      });
    }

    // Get SMC V4 data
    const smcResponse = await fetch(
      "https://smc-claude-webhook.vercel.app/api/analyze-v4"
    );

    const smcRaw = await smcResponse.text();

    if (!smcResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "SMC V4 request failed",
        status: smcResponse.status,
        details: smcRaw.substring(0, 1000)
      });
    }

    let smcData;

    try {
      smcData = JSON.parse(smcRaw);
    } catch {
      return res.status(500).json({
        success: false,
        error: "SMC V4 returned invalid JSON",
        details: smcRaw.substring(0, 1000)
      });
    }

    const prompt = `
You are a conservative SMC trading analyst.

Analyze this XAU/USD 5-minute SMC data:

${JSON.stringify(smcData)}

Return ONLY the following format.
Do NOT explain your reasoning.
Do NOT show chain of thought.

SIGNAL: BUY / SELL / WAIT
CONFIDENCE: 0-100
BIAS: BULLISH / BEARISH / NEUTRAL
MARKET QUALITY: A / B / C / D

ENTRY: price or NONE
STOP LOSS: price or NONE
TAKE PROFIT: price or NONE
RISK REWARD: value or NONE

REASONS:
- reason 1
- reason 2
- reason 3

WARNINGS:
- warning 1
- warning 2

ANALYSIS:
one short paragraph

Rules:
- Never guarantee profit.
- If confirmation is insufficient, use WAIT.
- Do not invent prices.
- No displacement = lower confidence.
- Conflicting evidence = prefer WAIT.
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
          // Specific fast free model instead of the free router
          model: "google/gemma-3-27b-it:free",

          messages: [
            {
              role: "system",
              content:
                "Return only the requested trading analysis format. Never output reasoning."
            },
            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0,
          max_tokens: 600
        })
      }
    );

    const aiRaw = await aiResponse.text();

    if (!aiResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter request failed",
        status: aiResponse.status,
        details: aiRaw.substring(0, 2000)
      });
    }

    let aiData;

    try {
      aiData = JSON.parse(aiRaw);
    } catch {
      return res.status(500).json({
        success: false,
        error: "OpenRouter returned invalid JSON",
        details: aiRaw.substring(0, 2000)
      });
    }

    let analysis = aiData?.choices?.[0]?.message?.content;

    if (Array.isArray(analysis)) {
      analysis = analysis
        .map(x => typeof x === "string" ? x : (x?.text || ""))
        .join("\n");
    }

    if (analysis !== null && analysis !== undefined) {
      analysis = String(analysis);
    }

    if (!analysis || !analysis.trim()) {
      return res.status(500).json({
        success: false,
        error: "AI returned empty analysis",
        finish_reason: aiData?.choices?.[0]?.finish_reason,
        model: aiData?.model,
        raw: aiData
      });
    }

    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → OpenRouter",
      model: aiData?.model || "google/gemma-3-27b-it:free",
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
