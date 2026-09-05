export default async function handler(req, res) {
  try {
    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=XAU/USD" +
      "&interval=5min" +
      "&outputsize=20" +
      "&apikey=" +
      process.env.TWELVE_DATA_API_KEY;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return res.status(500).json({
        success: false,
        error: data.message || "Twelve Data error"
      });
    }

    return res.status(200).json({
      success: true,
      symbol: "XAU/USD",
      interval: "5min",
      data: data.values
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
