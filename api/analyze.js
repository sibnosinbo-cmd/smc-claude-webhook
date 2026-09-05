export default async function handler(req, res) {
  try {
    // =========================================================
    // SMC ANALYZER V2
    // XAU/USD - 5 MINUTES
    // =========================================================

    const SYMBOL = "XAU/USD";
    const INTERVAL = "5min";
    const OUTPUT_SIZE = 300;

    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is missing"
      });
    }

    // =========================================================
    // 1. GET MARKET DATA
    // =========================================================

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

    if (!Array.isArray(marketData.values) || marketData.values.length < 50) {
      return res.status(500).json({
        success: false,
        error: "Not enough candle data"
      });
    }

    // Oldest -> newest
    const candles = marketData.values
      .map((c) => ({
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
      .filter(
        (c) =>
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
      )
      .reverse();

    // =========================================================
    // 2. HELPERS
    // =========================================================

    const round = (value, decimals = 5) => {
      if (value === null || value === undefined) return null;

      const factor = 10 ** decimals;
      return Math.round(value * factor) / factor;
    };

    const last = (arr) =>
      arr.length ? arr[arr.length - 1] : null;

    const body = (c) =>
      Math.abs(c.close - c.open);

    const range = (c) =>
      c.high - c.low;

    const upperWick = (c) =>
      c.high - Math.max(c.open, c.close);

    const lowerWick = (c) =>
      Math.min(c.open, c.close) - c.low;

    const bullish = (c) =>
      c.close > c.open;

    const bearish = (c) =>
      c.close < c.open;

    const average = (values) =>
      values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;

    const maxHigh = (arr) =>
      Math.max(...arr.map((c) => c.high));

    const minLow = (arr) =>
      Math.min(...arr.map((c) => c.low));

    // =========================================================
    // 3. SWING HIGH / LOW
    // =========================================================

    const swingHighs = [];
    const swingLows = [];

    const LEFT = 3;
    const RIGHT = 3;

    for (
      let i = LEFT;
      i < candles.length - RIGHT;
      i++
    ) {
      const c = candles[i];

      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= LEFT; j++) {
        if (c.high <= candles[i - j].high) {
          isSwingHigh = false;
        }

        if (c.low >= candles[i - j].low) {
          isSwingLow = false;
        }
      }

      for (let j = 1; j <= RIGHT; j++) {
        if (c.high <= candles[i + j].high) {
          isSwingHigh = false;
        }

        if (c.low >= candles[i + j].low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          price: c.high,
          datetime: c.datetime
        });
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          price: c.low,
          datetime: c.datetime
        });
      }
    }

    const recentHighs = swingHighs.slice(-12);
    const recentLows = swingLows.slice(-12);

    const latestSwingHigh = last(recentHighs);
    const previousSwingHigh =
      recentHighs.length >= 2
        ? recentHighs[recentHighs.length - 2]
        : null;

    const latestSwingLow = last(recentLows);
    const previousSwingLow =
      recentLows.length >= 2
        ? recentLows[recentLows.length - 2]
        : null;

    // =========================================================
    // 4. MARKET STRUCTURE
    // =========================================================

    let marketStructure = "NEUTRAL";

    if (
      latestSwingHigh &&
      previousSwingHigh &&
      latestSwingLow &&
      previousSwingLow
    ) {
      const higherHigh =
        latestSwingHigh.price > previousSwingHigh.price;

      const higherLow =
        latestSwingLow.price > previousSwingLow.price;

      const lowerHigh =
        latestSwingHigh.price < previousSwingHigh.price;

      const lowerLow =
        latestSwingLow.price < previousSwingLow.price;

      if (higherHigh && higherLow) {
        marketStructure = "BULLISH";
      }

      if (lowerHigh && lowerLow) {
        marketStructure = "BEARISH";
      }
    }

    // =========================================================
    // 5. BOS
    // =========================================================

    const bosEvents = [];

    let brokenHighIndex = null;
    let brokenLowIndex = null;

    for (let i = LEFT + RIGHT; i < candles.length; i++) {
      const c = candles[i];

      const availableHighs = swingHighs.filter(
        (s) => s.index < i
      );

      const availableLows = swingLows.filter(
        (s) => s.index < i
      );

      const lastHigh = last(availableHighs);
      const lastLow = last(availableLows);

      if (
        lastHigh &&
        c.close > lastHigh.price &&
        brokenHighIndex !== lastHigh.index
      ) {
        bosEvents.push({
          type: "BULLISH_BOS",
          datetime: c.datetime,
          index: i,
          price: c.close,
          brokenLevel: lastHigh.price
        });

        brokenHighIndex = lastHigh.index;
      }

      if (
        lastLow &&
        c.close < lastLow.price &&
        brokenLowIndex !== lastLow.index
      ) {
        bosEvents.push({
          type: "BEARISH_BOS",
          datetime: c.datetime,
          index: i,
          price: c.close,
          brokenLevel: lastLow.price
        });

        brokenLowIndex = lastLow.index;
      }
    }

    const latestBOS = last(bosEvents);

    // =========================================================
    // 6. CHOCH
    // =========================================================

    let choch = null;

    if (marketStructure === "BULLISH") {
      const bearishBreak = bosEvents.filter(
        (x) => x.type === "BEARISH_BOS"
      );

      if (bearishBreak.length) {
        choch = {
          type: "BEARISH_CHOCH",
          ...last(bearishBreak)
        };
      }
    }

    if (marketStructure === "BEARISH") {
      const bullishBreak = bosEvents.filter(
        (x) => x.type === "BULLISH_BOS"
      );

      if (bullishBreak.length) {
        choch = {
          type: "BULLISH_CHOCH",
          ...last(bullishBreak)
        };
      }
    }

    // =========================================================
    // 7. LIQUIDITY
    // =========================================================

    const liquiditySweeps = [];

    for (let i = 10; i < candles.length; i++) {
      const c = candles[i];

      const previous = candles.slice(i - 10, i);

      const recentHigh = maxHigh(previous);
      const recentLow = minLow(previous);

      // Buy-side liquidity sweep
      if (
        c.high > recentHigh &&
        c.close < recentHigh
      ) {
        liquiditySweeps.push({
          type: "BUY_SIDE_SWEEP",
          datetime: c.datetime,
          index: i,
          sweepPrice: c.high,
          reclaimedLevel: recentHigh
        });
      }

      // Sell-side liquidity sweep
      if (
        c.low < recentLow &&
        c.close > recentLow
      ) {
        liquiditySweeps.push({
          type: "SELL_SIDE_SWEEP",
          datetime: c.datetime,
          index: i,
          sweepPrice: c.low,
          reclaimedLevel: recentLow
        });
      }
    }

    const latestLiquiditySweep =
      last(liquiditySweeps);

    // =========================================================
    // 8. FAIR VALUE GAPS
    // =========================================================

    const fvgs = [];

    for (let i = 1; i < candles.length - 1; i++) {
      const left = candles[i - 1];
      const middle = candles[i];
      const right = candles[i + 1];

      // Bullish FVG
      if (left.high < right.low) {
        fvgs.push({
          type: "BULLISH_FVG",
          datetime: middle.datetime,
          index: i,
          low: left.high,
          high: right.low,
          midpoint: (left.high + right.low) / 2,
          filled: false
        });
      }

      // Bearish FVG
      if (left.low > right.high) {
        fvgs.push({
          type: "BEARISH_FVG",
          datetime: middle.datetime,
          index: i,
          low: right.high,
          high: left.low,
          midpoint: (right.high + left.low) / 2,
          filled: false
        });
      }
    }

    // Mark filled FVGs
    for (const fvg of fvgs) {
      for (
        let i = fvg.index + 2;
        i < candles.length;
        i++
      ) {
        const c = candles[i];

        if (
          c.low <= fvg.low &&
          c.high >= fvg.high
        ) {
          fvg.filled = true;
          fvg.filledAt = c.datetime;
          break;
        }
      }
    }

    const activeFVGs = fvgs.filter(
      (fvg) => !fvg.filled
    );

    const latestActiveFVG =
      last(activeFVGs);

    // =========================================================
    // 9. ORDER BLOCKS
    // =========================================================

    const orderBlocks = [];

    for (const bos of bosEvents) {
      const i = bos.index;

      if (i < 2) continue;

      let oppositeCandle = null;

      // Find last opposite candle before displacement
      for (
        let j = i - 1;
        j >= Math.max(0, i - 8);
        j--
      ) {
        const c = candles[j];

        if (
          bos.type === "BULLISH_BOS" &&
          bearish(c)
        ) {
          oppositeCandle = {
            index: j,
            candle: c
          };
          break;
        }

        if (
          bos.type === "BEARISH_BOS" &&
          bullish(c)
        ) {
          oppositeCandle = {
            index: j,
            candle: c
          };
          break;
        }
      }

      if (!oppositeCandle) continue;

      const ob = oppositeCandle.candle;

      orderBlocks.push({
        type:
          bos.type === "BULLISH_BOS"
            ? "BULLISH_ORDER_BLOCK"
            : "BEARISH_ORDER_BLOCK",

        datetime: ob.datetime,

        index: oppositeCandle.index,

        high: ob.high,

        low: ob.low,

        bosDatetime: bos.datetime,

        bosPrice: bos.price
      });
    }

    const latestOrderBlock =
      last(orderBlocks);

    // =========================================================
    // 10. PREMIUM / DISCOUNT
    // =========================================================

    const rangeCandles = candles.slice(-100);

    const rangeHigh = maxHigh(rangeCandles);
    const rangeLow = minLow(rangeCandles);

    const equilibrium =
      (rangeHigh + rangeLow) / 2;

    const currentPrice =
      last(candles).close;

    let zone = "EQUILIBRIUM";

    if (currentPrice > equilibrium) {
      zone = "PREMIUM";
    }

    if (currentPrice < equilibrium) {
      zone = "DISCOUNT";
    }

    // =========================================================
    // 11. DISPLACEMENT
    // =========================================================

    const recentBodies = candles
      .slice(-21, -1)
      .map(body);

    const averageBody =
      average(recentBodies);

    const currentCandle =
      last(candles);

    const displacement =
      body(currentCandle) >
      averageBody * 1.5;

    // =========================================================
    // 12. CONFLUENCE SCORE
    // =========================================================

    let bullishScore = 0;
    let bearishScore = 0;

    const reasonsBullish = [];
    const reasonsBearish = [];

    // Structure
    if (marketStructure === "BULLISH") {
      bullishScore += 25;
      reasonsBullish.push("Bullish market structure");
    }

    if (marketStructure === "BEARISH") {
      bearishScore += 25;
      reasonsBearish.push("Bearish market structure");
    }

    // BOS
    if (
      latestBOS &&
      latestBOS.type === "BULLISH_BOS"
    ) {
      bullishScore += 20;
      reasonsBullish.push("Bullish BOS");
    }

    if (
      latestBOS &&
      latestBOS.type === "BEARISH_BOS"
    ) {
      bearishScore += 20;
      reasonsBearish.push("Bearish BOS");
    }

    // CHOCH
    if (
      choch &&
      choch.type === "BULLISH_CHOCH"
    ) {
      bullishScore += 15;
      reasonsBullish.push("Bullish CHOCH");
    }

    if (
      choch &&
      choch.type === "BEARISH_CHOCH"
    ) {
      bearishScore += 15;
      reasonsBearish.push("Bearish CHOCH");
    }

    // Liquidity
    if (
      latestLiquiditySweep &&
      latestLiquiditySweep.type === "SELL_SIDE_SWEEP"
    ) {
      bullishScore += 15;
      reasonsBullish.push("Sell-side liquidity swept");
    }

    if (
      latestLiquiditySweep &&
      latestLiquiditySweep.type === "BUY_SIDE_SWEEP"
    ) {
      bearishScore += 15;
      reasonsBearish.push("Buy-side liquidity swept");
    }

    // Premium / Discount
    if (zone === "DISCOUNT") {
      bullishScore += 10;
      reasonsBullish.push("Price in discount");
    }

    if (zone === "PREMIUM") {
      bearishScore += 10;
      reasonsBearish.push("Price in premium");
    }

    // FVG
    if (
      latestActiveFVG &&
      latestActiveFVG.type === "BULLISH_FVG" &&
      currentPrice >= latestActiveFVG.low &&
      currentPrice <= latestActiveFVG.high
    ) {
      bullishScore += 10;
      reasonsBullish.push("Price inside bullish FVG");
    }

    if (
      latestActiveFVG &&
      latestActiveFVG.type === "BEARISH_FVG" &&
      currentPrice >= latestActiveFVG.low &&
      currentPrice <= latestActiveFVG.high
    ) {
      bearishScore += 10;
      reasonsBearish.push("Price inside bearish FVG");
    }

    // =========================================================
    // 13. BIAS
    // =========================================================

    let bias = "NEUTRAL";
    let confidence = 0;

    if (
      bullishScore >= 50 &&
      bullishScore > bearishScore + 10
    ) {
      bias = "BUY";
      confidence = bullishScore;
    }

    if (
      bearishScore >= 50 &&
      bearishScore > bullishScore + 10
    ) {
      bias = "SELL";
      confidence = bearishScore;
    }

    if (bias === "NEUTRAL") {
      confidence =
        Math.max(
          bullishScore,
          bearishScore
        );
    }

    // =========================================================
    // 14. ENTRY / STOP LOSS / TAKE PROFIT
    // =========================================================

    let entry = null;
    let stopLoss = null;
    let takeProfit = null;
    let riskReward = null;

    if (bias === "BUY") {
      entry = currentPrice;

      // Prefer bullish OB
      const bullishOB = [...orderBlocks]
        .reverse()
        .find(
          (ob) =>
            ob.type === "BULLISH_ORDER_BLOCK" &&
            ob.low < entry
        );

      if (bullishOB) {
        stopLoss = bullishOB.low;
      } else if (
        latestSwingLow &&
        latestSwingLow.price < entry
      ) {
        stopLoss = latestSwingLow.price;
      }

      if (
        stopLoss !== null &&
        entry > stopLoss
      ) {
        const risk = entry - stopLoss;

        // Target = 3R
        takeProfit = entry + risk * 3;

        riskReward = 3;
      }
    }

    if (bias === "SELL") {
      entry = currentPrice;

      const bearishOB = [...orderBlocks]
        .reverse()
        .find(
          (ob) =>
            ob.type === "BEARISH_ORDER_BLOCK" &&
            ob.high > entry
        );

      if (bearishOB) {
        stopLoss = bearishOB.high;
      } else if (
        latestSwingHigh &&
        latestSwingHigh.price > entry
      ) {
        stopLoss = latestSwingHigh.price;
      }

      if (
        stopLoss !== null &&
        stopLoss > entry
      ) {
        const risk = stopLoss - entry;

        // Target = 3R
        takeProfit = entry - risk * 3;

        riskReward = 3;
      }
    }

    // =========================================================
    // 15. FINAL SIGNAL
    // =========================================================

    let signal = "WAIT";

    if (
      bias !== "NEUTRAL" &&
      confidence >= 60 &&
      entry !== null &&
      stopLoss !== null &&
      takeProfit !== null
    ) {
      signal = bias;
    }

    // =========================================================
    // 16. MARKET STATE
    // =========================================================

    let marketState = "RANGING";

    if (marketStructure === "BULLISH") {
      marketState = "TRENDING_UP";
    }

    if (marketStructure === "BEARISH") {
      marketState = "TRENDING_DOWN";
    }

    if (
      latestLiquiditySweep &&
      latestLiquiditySweep.index >=
        candles.length - 3
    ) {
      marketState += "_LIQUIDITY_EVENT";
    }

    // =========================================================
    // 17. FINAL RESPONSE
    // =========================================================

    return res.status(200).json({
      success: true,

      analyzer: "SMC Analyzer V2",

      symbol: SYMBOL,

      timeframe: INTERVAL,

      timestamp: new Date().toISOString(),

      market: {
        currentPrice: round(currentPrice),
        rangeHigh: round(rangeHigh),
        rangeLow: round(rangeLow),
        equilibrium: round(equilibrium),
        zone,
        marketState,
        displacement
      },

      structure: {
        marketStructure,

        latestSwingHigh: latestSwingHigh
          ? {
              price: round(latestSwingHigh.price),
              datetime:
                latestSwingHigh.datetime
            }
          : null,

        previousSwingHigh: previousSwingHigh
          ? {
              price: round(previousSwingHigh.price),
              datetime:
                previousSwingHigh.datetime
            }
          : null,

        latestSwingLow: latestSwingLow
          ? {
              price: round(latestSwingLow.price),
              datetime:
                latestSwingLow.datetime
            }
          : null,

        previousSwingLow: previousSwingLow
          ? {
              price: round(previousSwingLow.price),
              datetime:
                previousSwingLow.datetime
            }
          : null,

        latestBOS: latestBOS
          ? {
              type: latestBOS.type,
              datetime: latestBOS.datetime,
              price: round(latestBOS.price),
              brokenLevel:
                round(latestBOS.brokenLevel)
            }
          : null,

        CHOCH: choch
          ? {
              type: choch.type,
              datetime: choch.datetime,
              price: round(choch.price)
            }
          : null
      },

      liquidity: {
        latestSweep:
          latestLiquiditySweep
            ? {
                type:
                  latestLiquiditySweep.type,
                datetime:
                  latestLiquiditySweep.datetime,
                sweepPrice:
                  round(
                    latestLiquiditySweep.sweepPrice
                  ),
                reclaimedLevel:
                  round(
                    latestLiquiditySweep.reclaimedLevel
                  )
              }
            : null,

        recentSweeps:
          liquiditySweeps
            .slice(-10)
            .map((x) => ({
              type: x.type,
              datetime: x.datetime,
              sweepPrice:
                round(x.sweepPrice),
              reclaimedLevel:
                round(x.reclaimedLevel)
            }))
      },

      fairValueGaps: {
        latestActive:
          latestActiveFVG
            ? {
                type:
                  latestActiveFVG.type,
                datetime:
                  latestActiveFVG.datetime,
                low:
                  round(latestActiveFVG.low),
                high:
                  round(latestActiveFVG.high),
                midpoint:
                  round(
                    latestActiveFVG.midpoint
                  )
              }
            : null,

        active:
          activeFVGs
            .slice(-10)
            .map((x) => ({
              type: x.type,
              datetime: x.datetime,
              low: round(x.low),
              high: round(x.high),
              midpoint:
                round(x.midpoint)
            }))
      },

      orderBlocks: {
        latest:
          latestOrderBlock
            ? {
                type:
                  latestOrderBlock.type,
                datetime:
                  latestOrderBlock.datetime,
                high:
                  round(
                    latestOrderBlock.high
                  ),
                low:
                  round(
                    latestOrderBlock.low
                  ),
                bosDatetime:
                  latestOrderBlock.bosDatetime
              }
            : null,

        recent:
          orderBlocks
            .slice(-10)
            .map((x) => ({
              type: x.type,
              datetime: x.datetime,
              high: round(x.high),
              low: round(x.low),
              bosDatetime:
                x.bosDatetime
            }))
      },

      confluence: {
        bullishScore,
        bearishScore,
        bullishReasons: reasonsBullish,
        bearishReasons: reasonsBearish
      },

      tradingPlan: {
        bias,
        signal,
        confidence: Math.min(confidence, 100),

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

        riskReward
      },

      candlesAnalyzed: candles.length,

      disclaimer:
        "Algorithmic SMC analysis for research and backtesting only. It is not financial advice and does not guarantee profitable trades."
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
