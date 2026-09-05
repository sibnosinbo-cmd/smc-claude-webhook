export default async function handler(req, res) {
  try {
    var apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is missing"
      });
    }

    var url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=XAU/USD" +
      "&interval=5min" +
      "&outputsize=100" +
      "&timezone=UTC" +
      "&apikey=" + encodeURIComponent(apiKey);

    var response = await fetch(url);
    var data = await response.json();

    if (!response.ok || data.status === "error") {
      return res.status(500).json({
        success: false,
        error: data.message || "Twelve Data error"
      });
    }

    return res.status(200).json({
      success: true,
      analyzer: "SMC Analyzer V3",
      symbol: "XAU/USD",
      timeframe: "5min",
      candles: data.values || [],
      candlesAnalyzed: data.values ? data.values.length : 0
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
