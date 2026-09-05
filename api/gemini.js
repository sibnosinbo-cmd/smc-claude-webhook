export default async function handler(req, res) {
  try {
    const API_KEY = process.env.OPENROUTER_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY غير موجود في Vercel"
      });
    }

    // جلب تحليل SMC V4
    const smcUrl =
      "https://smc-claude-webhook.vercel.app/api/analyze-v4";

    const smcResponse = await fetch(smcUrl);
    const smcText = await smcResponse.text();

    let smcData;

    try {
      smcData = JSON.parse(smcText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "تعذر قراءة نتيجة SMC Analyzer",
        details: smcText.slice(0, 1000)
      });
    }

    if (!smcResponse.ok || !smcData.success) {
      return res.status(500).json({
        success: false,
        error: "فشل SMC Analyzer",
        details: smcData
      });
    }

    // Prompt مختصر لتقليل استهلاك التوكنات
    const prompt = `
You are an SMC trading analyst.

Analyze ONLY the SMC data below.

IMPORTANT:
- Do not invent prices or market data.
- Do not contradict the supplied SMC data.
- Do not explain your reasoning process.
- Give only the final analysis.
- If there is no confirmed setup, use WAIT.
- Do not force BUY or SELL.

Return exactly this format:

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
Short final analysis.

SMC DATA:
${JSON.stringify(smcData, null, 2)}
`;

    // OpenRouter
    const aiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            "https://smc-claude-webhook.vercel.app",
          "X-Title": "SMC AI Analyzer"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0,
          max_tokens: 800
        })
      }
    );

    const aiText = await aiResponse.text();

    let aiData;

    try {
      aiData = JSON.parse(aiText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "OpenRouter أعاد استجابة غير صالحة",
        status: aiResponse.status,
        details: aiText.slice(0, 2000)
      });
    }

    if (!aiResponse.ok) {
      return res.status(aiResponse.status).json({
        success: false,
        error: "فشل طلب OpenRouter",
        status: aiResponse.status,
        details: aiData
      });
    }

    // استخراج المحتوى فقط
    const message = aiData?.choices?.[0]?.message;

    let analysis = message?.content;

    // بعض النماذج ترجع content كمصفوفة
    if (Array.isArray(analysis)) {
      analysis = analysis
        .map((item) => item?.text || "")
        .join("");
    }

    // إذا لم يرجع النموذج محتوى
    if (!analysis || !analysis.trim()) {
      return res.status(502).json({
        success: false,
        error: "OpenRouter أعاد تحليلًا فارغًا",
        model: aiData?.model || null,
        provider: aiData?.provider || null,
        finish_reason:
          aiData?.choices?.[0]?.finish_reason || null
      });
    }

    return res.status(200).json({
      success: true,
      system: "SMC Analyzer V4 + OpenRouter AI",
      model: aiData.model || "openrouter/free",
      timestamp: new Date().toISOString(),

      signal_source: "SMC V4",

      smc: {
        symbol: smcData.symbol,
        timeframe: smcData.timeframe,
        price: smcData.market?.price,
        marketStructure:
          smcData.structure?.marketStructure,
        bos: smcData.structure?.BOS,
        choch: smcData.structure?.CHOCH,
        liquidity: smcData.liquidity?.latestSweep,
        displacement: smcData.displacement,
        fvg: smcData.FVG,
        orderBlock: smcData.orderBlock,
        confluence: smcData.confluence,
        tradingPlan: smcData.tradingPlan
      },

      analysis: analysis.trim(),

      disclaimer:
        "Algorithmic SMC analysis for research and backtesting only. Not financial advice."
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message
    });
  }
  }
