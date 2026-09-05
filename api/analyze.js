export default async function handler(req, res) {
  try {
    // ==============================
    // CONFIG
    // ==============================

    const SYMBOL = "XAU/USD";
    const INTERVAL = "5min";
    const OUTPUT_SIZE = 200;

    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is missing"
      });
    }

    // ==============================
    // GET MARKET DATA
    // ==============================

    const url =
      "https://api.twelvedata.com/time_series" +
      `?symbol=${encodeURIComponent(SYMBOL)}` +
      `&interval=${INTERVAL}` +
      `&outputsize=${OUTPUT_SIZE}` +
      `&apikey=${API_KEY}`;

    const response = await fetch(url);
    const marketData = await response.json();

    if (!response.ok || marketData.status === "error") {
      return res.status(500).json({
        success: false,
        error: marketData.message || "Twelve Data error"
      });
    }

    if (!marketData.values || marketData.values.length < 20) {
      return res.status(500).json({
        success: false,
        error: "Not enough candle data"
      });
    }

    // Twelve Data returns newest first.
    // SMC calculations are easier oldest -> newest.
    const candles = marketData.values
      .map(c => ({
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
      .reverse();

    // ==============================
    // HELPERS
    // ==============================

    const round = (value, decimals = 2) => {
      const factor = Math.pow(10, decimals);
      return Math.round(value * factor) / factor;
    };

    const last = arr => arr[arr.length - 1];

    const highest = (arr, key) =>
      Math.max(...arr.map(x => x[key]));

    const lowest = (arr, key) =>
      Math.min(...arr.map(x => x[key]));

    const bodySize = candle =>
      Math.abs(candle.close - candle.open);

    const bullish = candle =>
      candle.close > candle.open;

    const bearish = candle =>
      candle.close < candle.open;

    // ==============================
    // SWING DETECTION
    // ==============================

    const swingHighs = [];
    const swingLows = [];

    const LEFT = 2;
    const RIGHT = 2;

    for (let i = LEFT; i < candles.length - RIGHT; i++) {

      const current = candles[i];

      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= LEFT; j++) {
        if (current.high <= candles[i - j].high) {
          isSwingHigh = false;
        }

        if (current.low >= candles[i - j].low) {
          isSwingLow = false;
        }
      }

      for (let j = 1; j <= RIGHT; j++) {
        if (current.high <= candles[i + j].high) {
          isSwingHigh = false;
        }

        if (current.low >= candles[i + j].low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          datetime: current.datetime,
          price: current.high
        });
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          datetime: current.datetime,
          price: current.low
        });
      }
    }

    // ==============================
    // CURRENT STRUCTURE
    // ==============================

    const recentSwingHighs = swingHighs.slice(-10);
    const recentSwingLows = swingLows.slice(-10);

    const latestSwingHigh = last(recentSwingHighs);
    const previousSwingHigh =
      recentSwingHighs.length >= 2
        ? recentSwingHighs[recentSwingHighs.length - 2]
        : null;

    const latestSwingLow = last(recentSwingLows);
    const previousSwingLow =
      recentSwingLows.length >= 2
        ? recentSwingLows[recentSwingLows.length - 2]
        : null;

    let marketStructure = "NEUTRAL";

    if (
      latestSwingHigh &&
      previousSwingHigh &&
      latestSwingLow &&
      previousSwingLow
    ) {
      if (
        latestSwingHigh.price > previousSwingHigh.price &&
        latestSwingLow.price > previousSwingLow.price
      ) {
        marketStructure = "BULLISH";
      }

      if (
        latestSwingHigh.price < previousSwingHigh.price &&
        latestSwingLow.price < previousSwingLow.price
      ) {
        marketStructure = "BEARISH";
      }
    }

    // ==============================
    // BOS DETECTION
    // ==============================

    const bosEvents = [];

    for (let i = 0; i < candles.length; i++) {

      const candle = candles[i];

      const previousHighs = swingHighs.filter(
        s => s.index < i
      );

      const previousLows = swingLows.filter(
        s => s.index < i
      );

      const lastHigh = last(previousHighs);
      const lastLow = last(previousLows);

      if (
        lastHigh &&
        candle.close > lastHigh.price
      ) {
        bosEvents.push({
          type: "BULLISH_BOS",
          datetime: candle.datetime,
          price: candle.close,
          brokenLevel: lastHigh.price
        });
      }

      if (
        lastLow &&
        candle.close < lastLow.price
      ) {
        bosEvents.push({
          type: "BEARISH_BOS",
          datetime: candle.datetime,
          price: candle.close,
          brokenLevel: lastLow.price
        });
      }
    }

    const latestBOS =
      bosEvents.length > 0
        ? last(bosEvents)
        : null;

    // ==============================
    // CHOCH DETECTION
    // ==============================

    let choch = null;

    if (marketStructure === "BULLISH") {

      const bearishBreak = bosEvents
        .filter(x => x.type === "BEARISH_BOS");

      if (bearishBreak.length > 0) {
        choch = {
          type: "BEARISH_CHOCH",
          datetime: last(bearishBreak).datetime,
          price: last(bearishBreak).price
        };
      }
    }

    if (marketStructure === "BEARISH") {

      const bullishBreak = bosEvents
        .filter(x => x.type === "BULLISH_BOS");

      if (bullishBreak.length > 0) {
        choch = {
          type: "BULLISH_CHOCH",
          datetime: last(bullishBreak).datetime,
          price: last(bullishBreak).price
        };
      }
    }

    // ==============================
    // LIQUIDITY SWEEPS
    // ==============================

    const liquiditySweeps = [];

    for (let i = 5; i < candles.length; i++) {

      const candle = candles[i];

      const previousCandles =
        candles.slice(Math.max(0, i - 10), i);

      const recentHigh =
        highest(previousCandles, "high");

      const recentLow =
        lowest(previousCandles, "low");

      // Buy-side liquidity sweep
      if (
        candle.high > recentHigh &&
        candle.close < recentHigh
      ) {
        liquiditySweeps.push({
          type: "BUY_SIDE_LIQUIDITY_SWEEP",
          datetime: candle.datetime,
          sweepPrice: candle.high,
          reclaimedLevel: recentHigh
        });
      }

      // Sell-side liquidity sweep
      if (
        candle.low < recentLow &&
        candle.close > recentLow
      ) {
        liquiditySweeps.push({
          type: "SELL_SIDE_LIQUIDITY_SWEEP",
          datetime: candle.datetime,
          sweepPrice: candle.low,
          reclaimedLevel: recentLow
        });
      }
    }

    const latestLiquiditySweep =
      last(liquiditySweeps) || null;

    // ==============================
    // FVG DETECTION
    // ==============================

    const fvgs = [];

    for (let i = 1; i < candles.length - 1; i++) {

      const previous = candles[i - 1];
      const current = candles[i];
      const next = candles[i + 1];

      // Bullish FVG
      if (previous.high < next.low) {

        fvgs.push({
          type: "BULLISH_FVG",
          datetime: current.datetime,
          low: previous.high,
          high: next.low,
          midpoint:
            (previous.high + next.low) / 2
        });
      }

      // Bearish FVG
      if (previous.low > next.high) {

        fvgs.push({
          type: "BEARISH_FVG",
          datetime: current.datetime,
          low: next.high,
          high: previous.low,
          midpoint:
            (next.high + previous.low) / 2
        });
      }
    }

    // ==============================
    // FVG STATUS
    // ==============================

    const currentPrice = last(candles).close;

    const activeFVGs = fvgs.filter(fvg => {

      if (fvg.type === "BULLISH_FVG") {
        return currentPrice >= fvg.low;
      }

      if (fvg.type === "BEARISH_FVG") {
        return currentPrice <= fvg.high;
      }

      return false;
    });

    const latestFVG =
      last(activeFVGs) || null;

    // ==============================
    // ORDER BLOCK DETECTION
    // ==============================

    const orderBlocks = [];

    for (let i = 2; i < candles.length; i++) {

      const candle = candles[i];
      const previous = candles[i - 1];

      const move =
        Math.abs(candle.close - previous.close);

      const averageBody =
        candles
          .slice(Math.max(0, i - 10), i)
          .reduce(
            (sum, c) => sum + bodySize(c),
            0
          ) / Math.min(i, 10);

      // Bullish displacement
      if (
        bullish(candle) &&
        move > averageBody * 1.5 &&
        bearish(previous)
      ) {

        orderBlocks.push({
          type: "BULLISH_ORDER_BLOCK",
          datetime: previous.datetime,
          high: previous.high,
          low: previous.low
        });
      }

      // Bearish displacement
      if (
        bearish(candle) &&
        move > averageBody * 1.5 &&
        bullish(previous)
      ) {

        orderBlocks.push({
          type: "BEARISH_ORDER_BLOCK",
          datetime: previous.datetime,
          high: previous.high,
          low: previous.low
        });
      }
    }

    const latestOrderBlock =
      last(orderBlocks) || null;

    // ==============================
    // PREMIUM / DISCOUNT
    // ==============================

    const recentRange = candles.slice(-50);

    const rangeHigh =
      highest(recentRange, "high");

    const rangeLow =
      lowest(recentRange, "low");

    const equilibrium =
      (rangeHigh + rangeLow) / 2;

    let zone = "EQUILIBRIUM";

    if (currentPrice > equilibrium) {
      zone = "PREMIUM";
    }

    if (currentPrice < equilibrium) {
      zone = "DISCOUNT";
    }

    // ==============================
    // TRADE BIAS
    // ==============================

    let bias = "NEUTRAL";
    let confidence = 0;

    if (marketStructure === "BULLISH") {
      confidence += 30;
    }

    if (marketStructure === "BEARISH") {
      confidence += 30;
    }

    if (
      latestBOS &&
      latestBOS.type === "BULLISH_BOS"
    ) {
      confidence += 20;
    }

    if (
      latestBOS &&
      latestBOS.type === "BEARISH_BOS"
    ) {
      confidence += 20;
    }

    if (
      latestLiquiditySweep &&
      latestLiquiditySweep.type ===
        "SELL_SIDE_LIQUIDITY_SWEEP"
    ) {
      confidence += 20;
    }

    if (
      latestLiquiditySweep &&
      latestLiquiditySweep.type ===
        "BUY_SIDE_LIQUIDITY_SWEEP"
    ) {
      confidence += 20;
    }

    if (marketStructure === "BULLISH") {
      bias = "BUY";
    }

    if (marketStructure === "BEARISH") {
      bias = "SELL";
    }

    // ==============================
    // ENTRY / SL / TP
    // ==============================

    let entry = null;
    let stopLoss = null;
    let takeProfit = null;
    let riskReward = null;

    if (bias === "BUY") {

      entry = currentPrice;

      if (latestOrderBlock &&
          latestOrderBlock.type ===
          "BULLISH_ORDER_BLOCK") {

        stopLoss = latestOrderBlock.low;
      } else if (latestSwingLow) {

        stopLoss = latestSwingLow.price;
      }

      if (stopLoss && entry > stopLoss) {

        const risk = entry - stopLoss;

        takeProfit = entry + risk * 3;

        riskReward = 3;
      }
    }

    if (bias === "SELL") {

      entry = currentPrice;

      if (latestOrderBlock &&
          latestOrderBlock.type ===
          "BEARISH_ORDER_BLOCK") {

        stopLoss = latestOrderBlock.high;
      } else if (latestSwingHigh) {

        stopLoss = latestSwingHigh.price;
      }

      if (stopLoss && stopLoss > entry) {

        const risk = stopLoss - entry;

        takeProfit = entry - risk * 3;

        riskReward = 3;
      }
    }

    // ==============================
    // SIGNAL QUALITY
    // ==============================

    let signal = "WAIT";

    if (
      bias !== "NEUTRAL" &&
      confidence >= 60 &&
      entry &&
      stopLoss &&
      takeProfit
    ) {
      signal = bias;
    }

    // ==============================
    // RESPONSE
    // ==============================

    return res.status(200).json({

      success: true,

      analyzer: "SMC Analyzer",

      symbol: SYMBOL,

      timeframe: INTERVAL,

      timestamp: new Date().toISOString(),

      market: {
        currentPrice: round(currentPrice, 5),
        rangeHigh: round(rangeHigh, 5),
        rangeLow: round(rangeLow, 5),
        equilibrium: round(equilibrium, 5),
        zone
      },

      structure: {
        marketStructure,

        latestSwingHigh: latestSwingHigh
          ? {
              price: round(latestSwingHigh.price, 5),
              datetime: latestSwingHigh.datetime
            }
          : null,

        latestSwingLow: latestSwingLow
          ? {
              price: round(latestSwingLow.price, 5),
              datetime: latestSwingLow.datetime
            }
          : null,

        BOS: latestBOS,

        CHOCH: choch
      },

      liquidity: {
        latestSweep: latestLiquiditySweep,

        recentSweeps:
          liquiditySweeps.slice(-10)
      },

      fairValueGaps: {
        latest: latestFVG,

        recent:
          fvgs.slice(-10)
      },

      orderBlocks: {
        latest: latestOrderBlock,

        recent:
          orderBlocks.slice(-10)
      },

      tradingPlan: {

        bias,

        signal,

        confidence: Math.min(confidence, 100),

        entry:
          entry !== null
            ? round(entry, 5)
            : null,

        stopLoss:
          stopLoss !== null
            ? round(stopLoss, 5)
            : null,

        takeProfit:
          takeProfit !== null
            ? round(takeProfit, 5)
            : null,

        riskReward
      },

      candlesAnalyzed: candles.length

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
