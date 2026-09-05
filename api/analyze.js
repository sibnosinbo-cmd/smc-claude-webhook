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
      "&outputsize=300" +
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

    if (!data.values || data.values.length < 100) {
      return res.status(500).json({
        success: false,
        error: "Not enough candle data"
      });
    }

    var candles = data.values.map(function (c) {
      return {
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      };
    }).reverse();

    var current = candles[candles.length - 1];
    var price = current.close;

    function avg(arr) {
      if (!arr.length) return 0;

      var total = 0;

      for (var i = 0; i < arr.length; i++) {
        total += arr[i];
      }

      return total / arr.length;
    }

    function maxHigh(arr) {
      var value = -Infinity;

      for (var i = 0; i < arr.length; i++) {
        if (arr[i].high > value) {
          value = arr[i].high;
        }
      }

      return value;
    }

    function minLow(arr) {
      var value = Infinity;

      for (var i = 0; i < arr.length; i++) {
        if (arr[i].low < value) {
          value = arr[i].low;
        }
      }

      return value;
    }

    function round(n) {
      return Math.round(n * 100000) / 100000;
    }

    // =========================
    // RANGE
    // =========================

    var rangeCandles = candles.slice(-100);

    var rangeHigh = maxHigh(rangeCandles);
    var rangeLow = minLow(rangeCandles);

    var equilibrium =
      (rangeHigh + rangeLow) / 2;

    var zone = "EQUILIBRIUM";

    if (price > equilibrium) {
      zone = "PREMIUM";
    }

    if (price < equilibrium) {
      zone = "DISCOUNT";
    }

    // =========================
    // SWING STRUCTURE
    // =========================

    var swingHigh = null;
    var swingLow = null;

    for (var i = 2; i < candles.length - 2; i++) {

      var h = candles[i];

      if (
        h.high > candles[i - 1].high &&
        h.high > candles[i - 2].high &&
        h.high > candles[i + 1].high &&
        h.high > candles[i + 2].high
      ) {
        swingHigh = {
          price: h.high,
          datetime: h.datetime,
          index: i
        };
      }

      if (
        h.low < candles[i - 1].low &&
        h.low < candles[i - 2].low &&
        h.low < candles[i + 1].low &&
        h.low < candles[i + 2].low
      ) {
        swingLow = {
          price: h.low,
          datetime: h.datetime,
          index: i
        };
      }
    }

    // =========================
    // BOS
    // =========================

    var latestBOS = null;

    for (var b = 10; b < candles.length; b++) {

      var candle = candles[b];

      var previous = candles.slice(
        Math.max(0, b - 20),
        b
      );

      var highLevel = maxHigh(previous);
      var lowLevel = minLow(previous);

      if (candle.close > highLevel) {
        latestBOS = {
          type: "BULLISH_BOS",
          price: candle.close,
          datetime: candle.datetime
        };
      }

      if (candle.close < lowLevel) {
        latestBOS = {
          type: "BEARISH_BOS",
          price: candle.close,
          datetime: candle.datetime
        };
      }
    }

    // =========================
    // LIQUIDITY SWEEP
    // =========================

    var latestSweep = null;

    for (var l = 10; l < candles.length; l++) {

      var lc = candles[l];

      var previousCandles = candles.slice(
        l - 10,
        l
      );

      var previousHigh =
        maxHigh(previousCandles);

      var previousLow =
        minLow(previousCandles);

      if (
        lc.high > previousHigh &&
        lc.close < previousHigh
      ) {
        latestSweep = {
          type: "BUY_SIDE_SWEEP",
          price: lc.high,
          datetime: lc.datetime
        };
      }

      if (
        lc.low < previousLow &&
        lc.close > previousLow
      ) {
        latestSweep = {
          type: "SELL_SIDE_SWEEP",
          price: lc.low,
          datetime: lc.datetime
        };
      }
    }

    // =========================
    // FVG
    // =========================

    var latestFVG = null;

    for (var f = 2; f < candles.length; f++) {

      var left = candles[f - 2];
      var right = candles[f];

      if (left.high < right.low) {

        latestFVG = {
          type: "BULLISH_FVG",
          low: left.high,
          high: right.low,
          midpoint:
            (left.high + right.low) / 2
        };
      }

      if (left.low > right.high) {

        latestFVG = {
          type: "BEARISH_FVG",
          low: right.high,
          high: left.low,
          midpoint:
            (right.high + left.low) / 2
        };
      }
    }

    // =========================
    // MOMENTUM
    // =========================

    var recent = candles.slice(-10);

    var bullish = 0;
    var bearish = 0;

    for (var m = 0; m < recent.length; m++) {

      if (recent[m].close > recent[m].open) {
        bullish++;
      }

      if (recent[m].close < recent[m].open) {
        bearish++;
      }
    }

    var momentum = "NEUTRAL";

    if (bullish >= 6) {
      momentum = "BULLISH";
    }

    if (bearish >= 6) {
      momentum = "BEARISH";
    }

    // =========================
    // SMC SCORE
    // =========================

    var buyScore = 0;
    var sellScore = 0;

    var buyReasons = [];
    var sellReasons = [];

    if (
      latestBOS &&
      latestBOS.type === "BULLISH_BOS"
    ) {
      buyScore += 25;
      buyReasons.push("Bullish BOS");
    }

    if (
      latestBOS &&
      latestBOS.type === "BEARISH_BOS"
    ) {
      sellScore += 25;
      sellReasons.push("Bearish BOS");
    }

    if (
      latestSweep &&
      latestSweep.type === "SELL_SIDE_SWEEP"
    ) {
      buyScore += 20;
      buyReasons.push("Sell-side liquidity sweep");
    }

    if (
      latestSweep &&
      latestSweep.type === "BUY_SIDE_SWEEP"
    ) {
      sellScore += 20;
      sellReasons.push("Buy-side liquidity sweep");
    }

    if (zone === "DISCOUNT") {
      buyScore += 15;
      buyReasons.push("Discount zone");
    }

    if (zone === "PREMIUM") {
      sellScore += 15;
      sellReasons.push("Premium zone");
    }

    if (momentum === "BULLISH") {
      buyScore += 10;
      buyReasons.push("Bullish momentum");
    }

    if (momentum === "BEARISH") {
      sellScore += 10;
      sellReasons.push("Bearish momentum");
    }

    if (
      latestFVG &&
      price >= latestFVG.low &&
      price <= latestFVG.high
    ) {

      if (latestFVG.type === "BULLISH_FVG") {
        buyScore += 15;
        buyReasons.push("Price inside bullish FVG");
      }

      if (latestFVG.type === "BEARISH_FVG") {
        sellScore += 15;
        sellReasons.push("Price inside bearish FVG");
      }
    }

    // =========================
    // FINAL SIGNAL
    // =========================

    var signal = "WAIT";
    var bias = "NEUTRAL";

    if (
      buyScore >= 60 &&
      buyScore > sellScore + 10
    ) {
      signal = "BUY";
      bias = "BULLISH";
    }

    if (
      sellScore >= 60 &&
      sellScore > buyScore + 10
    ) {
      signal = "SELL";
      bias = "BEARISH";
    }

    var confidence =
      Math.max(
        buyScore,
        sellScore
      );

    // =========================
    // TRADE PLAN
    // =========================

    var entry = null;
    var stopLoss = null;
    var takeProfit = null;

    if (signal === "BUY") {

      entry = price;

      if (swingLow) {
        stopLoss = swingLow.price;
      } else {
        stopLoss = rangeLow;
      }

      var riskBuy =
        entry - stopLoss;

      if (riskBuy > 0) {
        takeProfit =
          entry + riskBuy * 3;
      }
    }

    if (signal === "SELL") {

      entry = price;

      if (swingHigh) {
        stopLoss = swingHigh.price;
      } else {
        stopLoss = rangeHigh;
      }

      var riskSell =
        stopLoss - entry;

      if (riskSell > 0) {
        takeProfit =
          entry - riskSell * 3;
      }
    }

    // =========================
    // RESPONSE
    // =========================

    return res.status(200).json({

      success: true,

      analyzer: "SMC Analyzer V3",

      version: "3.0",

      symbol: "XAU/USD",

      timeframe: "5min",

      timestamp:
        new Date().toISOString(),

      market: {

        price: round(price),

        rangeHigh:
          round(rangeHigh),

        rangeLow:
          round(rangeLow),

        equilibrium:
          round(equilibrium),

        zone: zone,

        momentum: momentum
      },

      structure: {

        swingHigh:
          swingHigh
            ? round(swingHigh.price)
            : null,

        swingLow:
          swingLow
            ? round(swingLow.price)
            : null,

        latestBOS:
          latestBOS
            ? latestBOS
            : null
      },

      liquidity: {

        latestSweep:
          latestSweep
            ? latestSweep
            : null
      },

      fairValueGap: {

        latest:
          latestFVG
            ? {
                type: latestFVG.type,
                low: round(latestFVG.low),
                high: round(latestFVG.high),
                midpoint:
                  round(latestFVG.midpoint)
              }
            : null
      },

      confluence: {

        buyScore: buyScore,

        sellScore: sellScore,

        buyReasons: buyReasons,

        sellReasons: sellReasons
      },

      tradingPlan: {

        bias: bias,

        signal: signal,

        confidence: confidence,

        entry:
          entry !== null
            ? round(entry)
            : null,

        stopLoss:
          stopLoss !== null
            ? round(stopLoss)
            : null,

        takeProfit:
          takeProfit !== null
            ? round(takeProfit)
            : null,

        riskReward:
          signal === "BUY" ||
          signal === "SELL"
            ? 3
            : null
      },

      candlesAnalyzed:
        candles.length,

      disclaimer:
        "Algorithmic SMC analysis for research and backtesting only. Not financial advice."
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Internal server error"
    });
  }
        }
