export default async function handler(req, res) {
  try {
    // =========================================================
    // SMC ANALYZER V3
    // XAU/USD - 5 MIN
    // =========================================================

    const SYMBOL = "XAU/USD";
    const INTERVAL = "5min";
    const OUTPUT_SIZE = 500;
    const TIMEZONE = "UTC";

    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is missing"
      });
    }

    // =========================================================
    // 1. MARKET DATA
    // =========================================================

    const url =
      "https://api.twelvedata.com/time_series" +
      `?symbol=${encodeURIComponent(SYMBOL)}` +
      `&interval=${INTERVAL}` +
      `&outputsize=${OUTPUT_SIZE}` +
      `&timezone=${encodeURIComponent(TIMEZONE)}` +
      `&apikey=${API_KEY}`;

    const response = await fetch(url);
    const marketData = await response.json();

    if (!response.ok || marketData.status === "error") {
      return res.status(500).json({
        success: false,
        error: marketData.message || "Twelve Data error"
      });
    }

    if (
      !Array.isArray(marketData.values) ||
      marketData.values.length < 100
    ) {
      return res.status(500).json({
        success: false,
        error: "Not enough market data"
      });
    }

    // Twelve Data returns newest first.
    // Convert to oldest -> newest.
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

    if (candles.length < 100) {
      return res.status(500).json({
        success: false,
        error: "Not enough valid candles"
      });
    }

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

    const candleRange = (c) =>
      c.high - c.low;

    const upperWick = (c) =>
      c.high - Math.max(c.open, c.close);

    const lowerWick = (c) =>
      Math.min(c.open, c.close) - c.low;

    const bullish = (c) =>
      c.close > c.open;

    const bearish = (c) =>
      c.close < c.open;

    const average = (arr) =>
      arr.length
        ? arr.reduce((a, b) => a + b, 0) / arr.length
        : 0;

    const maxHigh = (arr) =>
      arr.length
        ? Math.max(...arr.map((c) => c.high))
        : null;

    const minLow = (arr) =>
      arr.length
        ? Math.min(...arr.map((c) => c.low))
        : null;

    const distance = (a, b) =>
      Math.abs(a - b);

    // =========================================================
    // 3. CURRENT PRICE
    // =========================================================

    const currentCandle = last(candles);
    const currentPrice = currentCandle.close;

    // =========================================================
    // 4. SWING DETECTION
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

      let high = true;
      let low = true;

      for (let j = 1; j <= LEFT; j++) {
        if (c.high <= candles[i - j].high) {
          high = false;
        }

        if (c.low >= candles[i - j].low) {
          low = false;
        }
      }

      for (let j = 1; j <= RIGHT; j++) {
        if (c.high <= candles[i + j].high) {
          high = false;
        }

        if (c.low >= candles[i + j].low) {
          low = false;
        }
      }

      if (high) {
        swingHighs.push({
          index: i,
          price: c.high,
          datetime: c.datetime
        });
      }

      if (low) {
        swingLows.push({
          index: i,
          price: c.low,
          datetime: c.datetime
        });
      }
    }

    const recentHighs = swingHighs.slice(-15);
    const recentLows = swingLows.slice(-15);

    const latestSwingHigh =
      last(recentHighs);

    const previousSwingHigh =
      recentHighs.length >= 2
        ? recentHighs[recentHighs.length - 2]
        : null;

    const latestSwingLow =
      last(recentLows);

    const previousSwingLow =
      recentLows.length >= 2
        ? recentLows[recentLows.length - 2]
        : null;

    // =========================================================
    // 5. STRUCTURE
    // =========================================================

    let structure = "NEUTRAL";

    let structureReason =
      "Insufficient confirmed swing structure";

    if (
      latestSwingHigh &&
      previousSwingHigh &&
      latestSwingLow &&
      previousSwingLow
    ) {
      const HH =
        latestSwingHigh.price >
        previousSwingHigh.price;

      const HL =
        latestSwingLow.price >
        previousSwingLow.price;

      const LH =
        latestSwingHigh.price <
        previousSwingHigh.price;

      const LL =
        latestSwingLow.price <
        previousSwingLow.price;

      if (HH && HL) {
        structure = "BULLISH";
        structureReason = "HH + HL";
      }

      if (LH && LL) {
        structure = "BEARISH";
        structureReason = "LH + LL";
      }

      if (
        (HH && LL) ||
        (LH && HL)
      ) {
        structure = "TRANSITION";
        structureReason =
          "Mixed swing structure";
      }
    }

    // =========================================================
    // 6. BOS / CHOCH
    // =========================================================

    const breakEvents = [];

    let brokenHigh = new Set();
    let brokenLow = new Set();

    for (
      let i = LEFT + RIGHT;
      i < candles.length;
      i++
    ) {
      const c = candles[i];

      const highsBefore =
        swingHighs.filter(
          (s) => s.index < i
        );

      const lowsBefore =
        swingLows.filter(
          (s) => s.index < i
        );

      const lastHigh =
        last(highsBefore);

      const lastLow =
        last(lowsBefore);

      if (
        lastHigh &&
        c.close > lastHigh.price &&
        !brokenHigh.has(lastHigh.index)
      ) {
        breakEvents.push({
          type: "BULLISH_BREAK",
          event: "BOS",
          index: i,
          datetime: c.datetime,
          price: c.close,
          brokenLevel: lastHigh.price
        });

        brokenHigh.add(lastHigh.index);
      }

      if (
        lastLow &&
        c.close < lastLow.price &&
        !brokenLow.has(lastLow.index)
      ) {
        breakEvents.push({
          type: "BEARISH_BREAK",
          event: "BOS",
          index: i,
          datetime: c.datetime,
          price: c.close,
          brokenLevel: lastLow.price
        });

        brokenLow.add(lastLow.index);
      }
    }

    const latestBreak =
      last(breakEvents);

    // Determine CHOCH from structure + opposite break.

    let choch = null;

    if (
      structure === "BULLISH" &&
      latestBreak &&
      latestBreak.type === "BEARISH_BREAK"
    ) {
      choch = {
        type: "BEARISH_CHOCH",
        ...latestBreak
      };
    }

    if (
      structure === "BEARISH" &&
      latestBreak &&
      latestBreak.type === "BULLISH_BREAK"
    ) {
      choch = {
        type: "BULLISH_CHOCH",
        ...latestBreak
      };
    }

    // =========================================================
    // 7. LIQUIDITY
    // =========================================================

    const liquiditySweeps = [];

    const LIQUIDITY_LOOKBACK = 12;

    for (
      let i = LIQUIDITY_LOOKBACK;
      i < candles.length;
      i++
    ) {
      const c = candles[i];

      const previous =
        candles.slice(
          i - LIQUIDITY_LOOKBACK,
          i
        );

      const high =
        maxHigh(previous);

      const low =
        minLow(previous);

      // Buy-side sweep
      if (
        c.high > high &&
        c.close < high
      ) {
        liquiditySweeps.push({
          type: "BUY_SIDE_SWEEP",
          index: i,
          datetime: c.datetime,
          sweepPrice: c.high,
          reclaimedLevel: high
        });
      }

      // Sell-side sweep
      if (
        c.low < low &&
        c.close > low
      ) {
        liquiditySweeps.push({
          type: "SELL_SIDE_SWEEP",
          index: i,
          datetime: c.datetime,
          sweepPrice: c.low,
          reclaimedLevel: low
        });
      }
    }

    const recentLiquidity =
      liquiditySweeps.filter(
        (x) =>
          x.index >= candles.length - 12
      );

    const latestLiquidity =
      last(recentLiquidity);

    // =========================================================
    // 8. FVG
    // =========================================================

    const fvgs = [];

    for (
      let i = 1;
      i < candles.length - 1;
      i++
    ) {
      const left = candles[i - 1];
      const middle = candles[i];
      const right = candles[i + 1];

      // Bullish FVG
      if (left.high < right.low) {
        fvgs.push({
          type: "BULLISH_FVG",
          index: i,
          datetime: middle.datetime,
          low: left.high,
          high: right.low,
          midpoint:
            (left.high + right.low) / 2,
          filled: false
        });
      }

      // Bearish FVG
      if (left.low > right.high) {
        fvgs.push({
          type: "BEARISH_FVG",
          index: i,
          datetime: middle.datetime,
          low: right.high,
          high: left.low,
          midpoint:
            (right.high + left.low) / 2,
          filled: false
        });
      }
    }

    // Check mitigation.

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

    const activeFVGs =
      fvgs.filter(
        (fvg) => !fvg.filled
      );

    // Closest active FVG to current price.

    const nearbyFVGs =
      activeFVGs
        .filter((fvg) => {
          const tolerance =
            Math.max(
              1,
              currentPrice * 0.001
            );

          return (
            currentPrice >= fvg.low - tolerance &&
            currentPrice <= fvg.high + tolerance
          );
        })
        .sort(
          (a, b) =>
            distance(
              currentPrice,
              a.midpoint
            ) -
            distance(
              currentPrice,
              b.midpoint
            )
        );

    const activeFVG =
      last(nearbyFVGs) || null;

    // =========================================================
    // 9. ORDER BLOCKS
    // =========================================================

    const orderBlocks = [];

    for (const event of breakEvents) {
      const i = event.index;

      let opposite = null;

      for (
        let j = i - 1;
        j >= Math.max(0, i - 10);
        j--
      ) {
        const c = candles[j];

        if (
          event.type === "BULLISH_BREAK" &&
          bearish(c)
        ) {
          opposite = {
            index: j,
            candle: c
          };
          break;
        }

        if (
          event.type === "BEARISH_BREAK" &&
          bullish(c)
        ) {
          opposite = {
            index: j,
            candle: c
          };
          break;
        }
      }

      if (!opposite) continue;

      const ob = opposite.candle;

      orderBlocks.push({
        type:
          event.type === "BULLISH_BREAK"
            ? "BULLISH_ORDER_BLOCK"
            : "BEARISH_ORDER_BLOCK",

        index: opposite.index,

        datetime: ob.datetime,

        high: ob.high,

        low: ob.low,

        bosDatetime: event.datetime,

        bosPrice: event.price,

        mitigated: false
      });
    }

    // Check OB mitigation.

    for (const ob of orderBlocks) {
      for (
        let i = ob.index + 1;
        i < candles.length;
        i++
      ) {
        const c = candles[i];

        if (
          c.low <= ob.low &&
          c.high >= ob.high
        ) {
          ob.mitigated = true;
          ob.mitigatedAt = c.datetime;
          break;
        }
      }
    }

    const activeOBs =
      orderBlocks.filter(
        (ob) => !ob.mitigated
      );

    const bullishOBs =
      activeOBs.filter(
        (ob) =>
          ob.type ===
          "BULLISH_ORDER_BLOCK"
      );

    const bearishOBs =
      activeOBs.filter(
        (ob) =>
          ob.type ===
          "BEARISH_ORDER_BLOCK"
      );

    const closestBullishOB =
      bullishOBs
        .filter(
          (ob) =>
            ob.low <= currentPrice
        )
        .sort(
          (a, b) =>
            currentPrice -
              a.low -
            (currentPrice -
              b.low)
        )[0] || null;

    const closestBearishOB =
      bearishOBs
        .filter(
          (ob) =>
            ob.high >= currentPrice
        )
        .sort(
          (a, b) =>
            a.high -
            currentPrice -
            (b.high -
              currentPrice)
        )[0] || null;

    // =========================================================
    // 10. PREMIUM / DISCOUNT
    // =========================================================

    const dealingRange =
      candles.slice(-150);

    const rangeHigh =
      maxHigh(dealingRange);

    const rangeLow =
      minLow(dealingRange);

    const equilibrium =
      (rangeHigh + rangeLow) / 2;

    let zone = "EQUILIBRIUM";

    if (
      currentPrice >
      equilibrium
    ) {
      zone = "PREMIUM";
    }

    if (
      currentPrice <
      equilibrium
    ) {
      zone = "DISCOUNT";
    }

    // =========================================================
    // 11. DISPLACEMENT
    // =========================================================

    const bodySamples =
      candles
        .slice(-31, -1)
        .map(body);

    const averageBody =
      average(bodySamples);

    const currentBody =
      body(currentCandle);

    const currentRange =
      candleRange(currentCandle);

    const displacement =
      averageBody > 0 &&
      currentBody >=
        averageBody * 1.5;

    const bullishDisplacement =
      displacement &&
      bullish(currentCandle);

    const bearishDisplacement =
      displacement &&
      bearish(currentCandle);

    // =========================================================
    // 12. INTERNAL MOMENTUM
    // =========================================================

    const recentCandles =
      candles.slice(-10);

    let bullishCandles = 0;
    let bearishCandles = 0;

    for (const c of recentCandles) {
      if (bullish(c)) bullishCandles++;
      if (bearish(c)) bearishCandles++;
    }

    let momentum = "NEUTRAL";

    if (
      bullishCandles >= 6
    ) {
      momentum = "BULLISH";
    }

    if (
      bearishCandles >= 6
    ) {
      momentum = "BEARISH";
    }

    // =========================================================
    // 13. DISTANCE TO LIQUIDITY
    // =========================================================

    const previousHigh =
      latestSwingHigh
        ? latestSwingHigh.price
        : null;

    const previousLow =
      latestSwingLow
        ? latestSwingLow.price
        : null;

    const distanceToHigh =
      previousHigh !== null
        ? distance(
            currentPrice,
            previousHigh
          )
        : null;

    const distanceToLow =
      previousLow !== null
        ? distance(
            currentPrice,
            previousLow
          )
        : null;

    // =========================================================
    // 14. CONFLUENCE ENGINE
    // =========================================================

    let bullishScore = 0;
    let bearishScore = 0;

    const bullishReasons = [];
    const bearishReasons = [];

    // Structure
    if (structure === "BULLISH") {
      bullishScore += 25;
      bullishReasons.push(
        "Bullish external structure"
      );
    }

    if (structure === "BEARISH") {
      bearishScore += 25;
      bearishReasons.push(
        "Bearish external structure"
      );
    }

    // BOS
    if (
      latestBreak &&
      latestBreak.type ===
        "BULLISH_BREAK"
    ) {
      bullishScore += 20;
      bullishReasons.push(
        "Recent bullish BOS"
      );
    }

    if (
      latestBreak &&
      latestBreak.type ===
        "BEARISH_BREAK"
    ) {
      bearishScore += 20;
      bearishReasons.push(
        "Recent bearish BOS"
      );
    }

    // CHOCH
    if (
      choch &&
      choch.type ===
        "BULLISH_CHOCH"
    ) {
      bullishScore += 15;
      bullishReasons.push(
        "Bullish CHOCH"
      );
    }

    if (
      choch &&
      choch.type ===
        "BEARISH_CHOCH"
    ) {
      bearishScore += 15;
      bearishReasons.push(
        "Bearish CHOCH"
      );
    }

    // Liquidity
    if (
      latestLiquidity &&
      latestLiquidity.type ===
        "SELL_SIDE_SWEEP"
    ) {
      bullishScore += 15;
      bullishReasons.push(
        "Sell-side liquidity swept"
      );
    }

    if (
      latestLiquidity &&
      latestLiquidity.type ===
        "BUY_SIDE_SWEEP"
    ) {
      bearishScore += 15;
      bearishReasons.push(
        "Buy-side liquidity swept"
      );
    }

    // Zone
    if (zone === "DISCOUNT") {
      bullishScore += 10;
      bullishReasons.push(
        "Price in discount"
      );
    }

    if (zone === "PREMIUM") {
      bearishScore += 10;
      bearishReasons.push(
        "Price in premium"
      );
    }

    // FVG
    if (
      activeFVG &&
      activeFVG.type ===
        "BULLISH_FVG" &&
      currentPrice >=
        activeFVG.low &&
      currentPrice <=
        activeFVG.high
    ) {
      bullishScore += 10;
      bullishReasons.push(
        "Price interacting with bullish FVG"
      );
    }

    if (
      activeFVG &&
      activeFVG.type ===
        "BEARISH_FVG" &&
      currentPrice >=
        activeFVG.low &&
      currentPrice <=
        activeFVG.high
    ) {
      bearishScore += 10;
      bearishReasons.push(
        "Price interacting with bearish FVG"
      );
    }

    // OB
    if (
      closestBullishOB &&
      currentPrice >=
        closestBullishOB.low &&
      currentPrice <=
        closestBullishOB.high
    ) {
      bullishScore += 10;
      bullishReasons.push(
        "Price inside bullish order block"
      );
    }

    if (
      closestBearishOB &&
      currentPrice >=
        closestBearishOB.low &&
      currentPrice <=
        closestBearishOB.high
    ) {
      bearishScore += 10;
      bearishReasons.push(
        "Price inside bearish order block"
      );
    }

    // Momentum
    if (momentum === "BULLISH") {
      bullishScore += 5;
      bullishReasons.push(
        "Bullish short-term momentum"
      );
    }

    if (momentum === "BEARISH") {
      bearishScore += 5;
      bearishReasons.push(
        "Bearish short-term momentum"
      );
    }

    // =========================================================
    // 15. BIAS
    // =========================================================

    let bias = "NEUTRAL";

    if (
      bullish
