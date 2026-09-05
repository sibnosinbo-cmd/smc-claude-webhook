<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMC AI Trader</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0b0f19;
      color: white;
      min-height: 100vh;
    }

    .container {
      max-width: 700px;
      margin: auto;
      padding: 25px 15px;
    }

    h1 {
      text-align: center;
      margin-bottom: 5px;
    }

    .subtitle {
      text-align: center;
      color: #9ca3af;
      margin-bottom: 25px;
    }

    .card {
      background: #111827;
      border: 1px solid #263244;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 15px;
    }

    button {
      width: 100%;
      padding: 15px;
      border: 0;
      border-radius: 12px;
      background: #2563eb;
      color: white;
      font-size: 17px;
      font-weight: bold;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.6;
    }

    .signal {
      text-align: center;
      font-size: 38px;
      font-weight: bold;
      margin: 15px 0;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .box {
      background: #0b1220;
      padding: 14px;
      border-radius: 10px;
    }

    .label {
      color: #9ca3af;
      font-size: 13px;
    }

    .value {
      font-size: 18px;
      margin-top: 5px;
      font-weight: bold;
    }

    pre {
      white-space: pre-wrap;
      line-height: 1.7;
      font-family: Arial, sans-serif;
    }

    .status {
      text-align: center;
      color: #9ca3af;
      margin: 15px;
    }
  </style>
</head>

<body>

<div class="container">

  <h1>🤖 SMC AI Trader</h1>
  <div class="subtitle">XAU/USD • 5 Minutes</div>

  <div class="card">
    <button id="analyzeBtn" onclick="analyze()">
      🔍 ANALYZE GOLD
    </button>

    <div id="status" class="status"></div>
  </div>

  <div class="card">

    <div id="signal" class="signal">
      WAIT
    </div>

    <div class="grid">

      <div class="box">
        <div class="label">Confidence</div>
        <div id="confidence" class="value">-</div>
      </div>

      <div class="box">
        <div class="label">Bias</div>
        <div id="bias" class="value">-</div>
      </div>

      <div class="box">
        <div class="label">Entry</div>
        <div id="entry" class="value">-</div>
      </div>

      <div class="box">
        <div class="label">Stop Loss</div>
        <div id="sl" class="value">-</div>
      </div>

      <div class="box">
        <div class="label">Take Profit</div>
        <div id="tp" class="value">-</div>
      </div>

      <div class="box">
        <div class="label">Risk / Reward</div>
        <div id="rr" class="value">-</div>
      </div>

    </div>

  </div>

  <div class="card">

    <h3>📊 AI Analysis</h3>

    <pre id="analysis">
اضغط ANALYZE GOLD للحصول على التحليل...
    </pre>

  </div>

</div>

<script>

async function analyze() {

  const button = document.getElementById("analyzeBtn");
  const status = document.getElementById("status");

  button.disabled = true;
  status.innerText = "⏳ جاري تحليل الذهب...";

  try {

    const response = await fetch("/api/gemini");

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Analysis failed");
    }

    const text = data.analysis || "";

    const signal = getValue(text, "SIGNAL:");
    const confidence = getValue(text, "CONFIDENCE:");
    const bias = getValue(text, "BIAS:");
    const entry = getValue(text, "ENTRY:");
    const sl = getValue(text, "STOP LOSS:");
    const tp = getValue(text, "TAKE PROFIT:");
    const rr = getValue(text, "RISK REWARD:");

    document.getElementById("signal").innerText = signal || "WAIT";
    document.getElementById("confidence").innerText = confidence || "-";
    document.getElementById("bias").innerText = bias || "-";
    document.getElementById("entry").innerText = entry || "-";
    document.getElementById("sl").innerText = sl || "-";
    document.getElementById("tp").innerText = tp || "-";
    document.getElementById("rr").innerText = rr || "-";

    document.getElementById("analysis").innerText = text;

    status.innerText = "✅ تم التحليل بنجاح";

  } catch (error) {

    status.innerText = "❌ حدث خطأ: " + error.message;

  }

  button.disabled = false;
}


function getValue(text, label) {

  const lines = text.split("\n");

  const line = lines.find(l =>
    l.trim().toUpperCase().startsWith(label)
  );

  if (!line) return "";

  return line.substring(label.length).trim();

}

</script>

</body>
</html>
