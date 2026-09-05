export default async function handler(req, res) {
  // السماح بـ GET و POST
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENROUTER_API_KEY غير موجود في Vercel"
      });
    }

    // جلب تحليل SMC V4
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://smc-claude-webhook.vercel.app";

    const smcResponse = await fetch(`${baseUrl}/api/analyze-v4`);

    if (!smcResponse.ok) {
      const errorText = await smcResponse.text();

      return res.status(500).json({
        success: false,
        error: "فشل في جلب تحليل SMC V4",
        details: errorText
      });
    }

    const smcData = await smcResponse.json();

    // البيانات التي سنرسلها إلى الذكاء الاصطناعي
    const prompt = `
أنت محلل تداول محترف متخصص في Smart Money Concepts (SMC).

حلل بيانات XAU/USD التالية:

${JSON.stringify(smcData, null, 2)}

أعطني تحليلًا محافظًا وواضحًا.

القواعد:
- لا تخترع بيانات غير موجودة.
- إذا كانت المعطيات غير كافية، SIGNAL يجب أن يكون WAIT.
- لا تعطِ BUY أو SELL لمجرد وجود عامل واحد.
- انتبه إلى Liquidity Sweep و BOS و CHOCH و FVG و Order Block و Premium/Discount.
- إذا لم يوجد Displacement واضح، خفّض الثقة.
- لا تضمن الربح.

أجب بهذا الشكل بالضبط:

SIGNAL: BUY أو SELL أو WAIT
CONFIDENCE: رقم من 0 إلى 100
BIAS: BULLISH أو BEARISH أو NEUTRAL
MARKET QUALITY: A أو B أو C أو D
ENTRY: رقم أو NONE
STOP LOSS: رقم أو NONE
TAKE PROFIT: رقم أو NONE
RISK REWARD: رقم أو NONE
REASONS:
- السبب الأول
- السبب الثاني
- السبب الثالث

WARNINGS:
- التحذير الأول
- التحذير الثاني

ANALYSIS:
شرح مختصر للتحليل.
`;

    // إرسال البيانات إلى OpenRouter
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
                "You are a conservative professional SMC trading analyst."
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

    const aiText = await aiResponse.text();

    if (!aiResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "OpenRouter API Error",
        status: aiResponse.status,
        details: aiText
      });
    }

    // تحويل رد OpenRouter إلى JSON
    let aiData;

    try {
      aiData = JSON.parse(aiText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "OpenRouter returned invalid response",
        raw: aiText
      });
    }

    const content = aiData?.choices?.[0]?.message?.content;

    // حماية من crash إذا كان content ليس string
    let analysisText = "";

    if (typeof content === "string") {
      analysisText = content;
    } else if (Array.isArray(content)) {
      analysisText = content
        .map(item => {
          if (typeof item === "string") return item;
          return item?.text || "";
        })
        .join("\n");
    } else if (content != null) {
      analysisText = String(content);
    }

    if (!analysisText.trim()) {
      return res.status(500).json({
        success: false,
        error: "AI returned empty analysis",
        raw: aiData
      });
    }

    // النتيجة النهائية
    return res.status(200).json({
      success: true,
      system: "XAU/USD → Twelve Data → SMC V4 → OpenRouter",
      model: "openrouter/free",
      timestamp: new Date().toISOString(),

      smc: smcData,

      analysis: analysisText,

      disclaimer:
        "تحليل آلي لأغراض البحث والاختبار فقط، وليس نصيحة مالية."
    });

  } catch (error) {
    console.error("GEMINI/OPENROUTER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error?.message || String(error)
    });
  }
      }
