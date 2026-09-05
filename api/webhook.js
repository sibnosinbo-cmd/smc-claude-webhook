export default async function handler(req, res) {
  try {
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

    // ==============================
    // 1. GET MARKET DATA
    // ==============================

    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=" + encodeURIComponent(SYMBOL) +
      "&interval=" + INTERVAL +
      "&outputsize=" + OUTPUT_SIZE +
      "&timezone=" + encodeURIComponent(TIMEZONE) +
      "&apikey=" + encodeURIComponent(API_KEY);

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
        error: "Not enough candle data"
      });
    }

    const candles = marketData.values
      .map(function (c) {
        return {
          datetime: c.datetime,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close)
        };
      })
      .filter(function (c) {
        return (
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
        );
      })
      .reverse();

    if (candles.length < 100) {
      return res.status(500).json({
        success: false,
        error: "Not enough valid candles"
      });
    }

    // ==============================
    // 2. HELPERS
    // ==============================

    function round(value, decimals) {
      if (value === null || value === undefined) {
        return null;
      }

      decimals = decimals || 5;

      var factor = Math.pow(10, decimals);

      return Math.round(value * factor) / factor;
    }

    function last(arr) {
      return arr.length ? arr[arr.length - 1] : null;
    }

    function body(c) {
      return Math.abs(c.close - c.open);
    }

    function range(c) {
      return c.high - c.low;
    }

    function bullish(c) {
      return c.close > c.open;
    }

    function bearish(c) {
      return c.close < c.open;
    }

    function average(arr) {
      if (!arr.length) {
        return 0;
      }

      return (
        arr.reduce(function (a, b) {
          return a + b;
        }, 0) / arr.length
      );
    }

    function maxHigh(arr) {
      if (!arr.length) {
        return null;
      }

      return Math.max.apply(
        null,
        arr.map(function (c) {
          return c.high;
        })
      );
    }

    function minLow(arr) {
      if (!arr.length) {
        return null;
      }

      return Math.min.apply(
        null,
        arr.map(function (c) {
          return c.low;
        })
      );
    }

    function distance(a, b) {
      return Math.abs(a - b);
    }

    // ==============================
    // 3. CURRENT MARKET
    // ==============================

    var currentCandle = last(candles);
    var currentPrice = currentCandle.close;

    // ==============================
    // 4. SWINGS
    // ==============================

    var swingHighs = [];
    var swingLows = [];

    var LEFT = 3;
    var RIGHT = 3;

    for (
      var i = LEFT;
      i < candles.length - RIGHT;
      i++
    ) {
      var c = candles[i];

      var isHigh = true;
      var isLow = true;

      for (var j = 1; j <= LEFT; j++) {
        if (c.high <= candles[i - j].high) {
          isHigh = false;
        }

        if (c.low >= candles[i - j].low) {
          isLow = false;
        }
      }

      for (var k = 1; k <= RIGHT; k++) {
        if (c.high <= candles[i + k].high) {
          isHigh = false;
        }

        if (c.low >= candles[i + k].low) {
          isLow = false;
        }
      }

      if (isHigh) {
        swingHighs.push({
          index: i,
          price: c.high,
          datetime: c.datetime
        });
      }

      if (isLow) {
        swingLows.push({
          index: i,
          price: c.low,
          datetime: c.datetime
        });
      }
    }

    var latestSwingHigh = last(swingHighs);
    var previousSwingHigh =
      swingHighs.length >= 2
        ? swingHighs[swingHighs.length - 2]
        : null;

    var latestSwingLow = last(swingLows);
    var previousSwingLow =
      swingLows.length >= 2
        ? swingLows[swingLows.length - 2]
        : null;

    // ==============================
    // 5. MARKET STRUCTURE
    // ==============================

    var marketStructure = "NEUTRAL";
    var structureReason = "No confirmed structure";

    if (
      latestSwingHigh &&
      previousSwingHigh &&
      latestSwingLow &&
      previousSwingLow
    ) {
      var HH =
        latestSwingHigh.price >
        previousSwingHigh.price;

      var HL =
        latestSwingLow.price >
        previousSwingLow.price;

      var LH =
        latestSwingHigh.price <
        previousSwingHigh.price;

      var LL =
        latestSwingLow.price <
        previousSwingLow.price;

      if (HH && HL) {
        marketStructure = "BULLISH";
        structureReason = "HH + HL";
      } else if (LH && LL) {
        marketStructure = "BEARISH";
        structureReason = "LH + LL";
      } else {
        marketStructure = "TRANSITION";
        structureReason = "Mixed structure";
      }
    }

    // ==============================
    // 6. BOS
    // ==============================

    var bosEvents = [];

    for (
      var b = LEFT + RIGHT;
      b < candles.length;
      b++
    ) {
      var candle = candles[b];

      var highsBefore = swingHighs.filter(
        function (s) {
          return s.index < b;
        }
      );

      var lowsBefore = swingLows.filter(
        function (s) {
          return s.index < b;
        }
      );

      var highLevel = last(highsBefore);
      var lowLevel = last(lowsBefore);

      if (
        highLevel &&
        candle.close > highLevel.price
      ) {
        bosEvents.push({
          type: "BULLISH_BOS",
          datetime: candle.datetime,
          index: b,
          price: candle.close,
          brokenLevel: highLevel.price
        });
      }

      if (
        lowLevel &&
        candle.close < lowLevel.price
      ) {
        bosEvents.push({
          type: "BEARISH_BOS",
          datetime: candle.datetime,
          index: b,
          price: candle.close,
          brokenLevel: lowLevel.price
        });
      }
    }

    var latestBOS = last(bosEvents);

    // ==============================
    // 7. CHOCH
    // ==============================

    var choch = null;

    if (
      marketStructure === "BULLISH" &&
      latestBOS &&
      latestBOS.type === "BEARISH_BOS"
    ) {
      choch = {
        type: "BEARISH_CHOCH",
        datetime: latestBOS.datetime,
        price: latestBOS.price
      };
    }

    if (
      marketStructure === "BEARISH" &&
      latestBOS &&
      latestBOS.type === "BULLISH_BOS"
    ) {
      choch = {
        type: "BULLISH_CHOCH",
        datetime: latestBOS.datetime,
        price: latestBOS.price
      };
    }

    // ==============================
    // 8. LIQUIDITY SWEEPS
    // ==============================

    var liquiditySweeps = [];
    var LIQUIDITY_LOOKBACK = 12;

    for (
      var l = LIQUIDITY_LOOKBACK;
      l < candles.length;
      l++
    ) {
      var lc = candles[l];

      var previousCandles = candles.slice(
        l - LIQUIDITY_LOOKBACK,
        l
      );

      var localHigh = maxHigh(previousCandles);
      var localLow = minLow(previousCandles);

      if (
        lc.high > localHigh &&
        lc.close < localHigh
      ) {
        liquiditySweeps.push({
          type: "BUY_SIDE_SWEEP",
          index: l,
          datetime: lc.datetime,
          sweepPrice: lc.high,
          reclaimedLevel: localHigh
        });
      }

      if (
        lc.low < localLow &&
        lc.close > localLow
      ) {
        liquiditySweeps.push({
          type: "SELL_SIDE_SWEEP",
          index: l,
          datetime: lc.datetime,
          sweepPrice: lc.low,
          reclaimedLevel: localLow
        });
      }
    }

    var recentSweeps =
      liquiditySweeps.filter(function (x) {
        return x.index >= candles.length - 15;
      });

    var latestSweep = last(recentSweeps);

    // ==============================
    // 9. FAIR VALUE GAPS
    // ==============================

    var fvgs = [];

    for (
      var f = 1;
      f < candles.length - 1;
      f++
    ) {
      var leftCandle = candles[f - 1];
      var middleCandle = candles[f];
      var rightCandle = candles[f + 1];

      if (
        leftCandle.high <
        rightCandle.low
      ) {
        fvgs.push({
          type: "BULLISH_FVG",
          index: f,
          datetime: middleCandle.datetime,
          low: leftCandle.high,
          high: rightCandle.low,
          midpoint:
            (leftCandle.high +
              rightCandle.low) /
            2,
          filled: false
        });
      }

      if (
        leftCandle.low >
        rightCandle.high
      ) {
        fvgs.push({
          type: "BEARISH_FVG",
          index: f,
          datetime: middleCandle.datetime,
          low: rightCandle.high,
          high: leftCandle.low,
          midpoint:
            (rightCandle.high +
              leftCandle.low) /
            2,
          filled: false
        });
      }
    }

    for (var fi = 0; fi < fvgs.length; fi++) {
      var fvg = fvgs[fi];

      for (
        var fc = fvg.index + 2;
        fc < candles.length;
        fc++
      ) {
        var fillCandle = candles[fc];

        if (
          fillCandle.low <= fvg.low &&
          fillCandle.high >= fvg.high
        ) {
          fvg.filled = true;
          fvg.filledAt =
            fillCandle.datetime;
          break;
        }
      }
    }

    var activeFVGs = fvgs.filter(
      function (x) {
        return !x.filled;
      }
    );

    // Find closest active FVG.

    var nearestFVG = null;
    var nearestFVGDistance = Infinity;

    for (
      var af = 0;
      af < activeFVGs.length;
      af++
    ) {
      var candidateFVG =
        activeFVGs[af];

      var fvgDistance;

      if (
        currentPrice >=
          candidateFVG.low &&
        currentPrice <=
          candidateFVG.high
      ) {
        fvgDistance = 0;
      } else {
        fvgDistance =
          distance(
            currentPrice,
            candidateFVG.midpoint
          );
      }

      if (
        fvgDistance <
        nearestFVGDistance
      ) {
        nearestFVGDistance =
          fvgDistance;

        nearestFVG =
          candidateFVG;
      }
    }

    // ==============================
    // 10. ORDER BLOCKS
    // ==============================

    var orderBlocks = [];

    for (
      var oi = 0;
      oi < bosEvents.length;
      oi++
    ) {
      var bos = bosEvents[oi];

      var opposite = null;

      for (
        var oj = bos.index - 1;
        oj >=
        Math.max(0, bos.index - 10);
        oj--
      ) {
        var oc = candles[oj];

        if (
          bos.type === "BULLISH_BOS" &&
          bearish(oc)
        ) {
          opposite = {
            index: oj,
            candle: oc
          };
          break;
        }

        if (
          bos.type === "BEARISH_BOS" &&
          bullish(oc)
        ) {
          opposite = {
            index: oj,
            candle: oc
          };
          break;
        }
      }

      if (!opposite) {
        continue;
      }

      orderBlocks.push({
        type:
          bos.type === "BULLISH_BOS"
            ? "BULLISH_ORDER_BLOCK"
            : "BEARISH_ORDER_BLOCK",

        index: opposite.index,

        datetime:
          opposite.candle.datetime,

        low:
          opposite.candle.low,

        high:
          opposite.candle.high,

        bosDatetime:
          bos.datetime,

        mitigated: false
      });
    }

    // Check mitigation.

    for (
      var obi = 0;
      obi < orderBlocks.length;
      obi++
    ) {
      var ob = orderBlocks[obi];

      for (
        var oc2 = ob.index + 1;
        oc2 < candles.length;
        oc2++
      ) {
        var check = candles[oc2];

        if (
          check.low <= ob.low &&
          check.high >= ob.high
        ) {
          ob.mitigated = true;
          ob.mitigatedAt =
            check.datetime;
          break;
        }
      }
    }

    var activeOBs =
      orderBlocks.filter(
        function (x) {
          return !x.mitigated;
        }
      );

    var bullishOBs =
      activeOBs.filter(
        function (x) {
          return (
            x.type ===
            "BULLISH_ORDER_BLOCK"
          );
        }
      );

    var bearishOBs =
      activeOBs.filter(
        function (x) {
          return (
            x.type ===
            "BEARISH_ORDER_BLOCK"
          );
        }
      );

    var nearestBullishOB = null;
    var nearestBullishDistance =
      Infinity;

    for (
      var bo = 0;
      bo < bullishOBs.length;
      bo++
    ) {
      var bullishOB =
        bullishOBs[bo];

      if (
        bullishOB.low <=
        currentPrice
      ) {
        var bd = distance(
          currentPrice,
          bullishOB.high
        );

        if (
          bd <
          nearestBullishDistance
        ) {
          nearestBullishDistance = bd;
          nearestBullishOB =
            bullishOB;
        }
      }
    }

    var nearestBearishOB = null;
    var nearestBearishDistance =
      Infinity;

    for (
      var so = 0;
      so < bearishOBs.length;
      so++
    ) {
      var bearishOB =
        bearishOBs[so];

      if (
        bearishOB.high >=
        currentPrice
      ) {
        var sd = distance(
          currentPrice,
          bearishOB.low
        );

        if (
          sd <
          nearestBearishDistance
        ) {
          nearestBearishDistance = sd;
          nearestBearishOB =
            bearishOB;
        }
      }
    }

    // ==============================
    // 11. PREMIUM / DISCOUNT
    // ==============================

    var dealingRange =
      candles.slice(-150);

    var rangeHigh =
      maxHigh(dealingRange);

    var rangeLow =
      minLow(dealingRange);

    var equilibrium =
      (rangeHigh + rangeLow) / 2;

    var zone = "EQUILIBRIUM";

    if (
      currentPrice >
      equilibrium
    ) {
      zone = "PREMIUM";
    } else if (
      currentPrice <
      equilibrium
    ) {
      zone = "DISCOUNT";
    }

    // ==============================
    // 12. DISPLACEMENT
    // ==============================

    var bodySamples =
      candles
        .slice(-31, -1)
        .map(function (c) {
          return body(c);
        });

    var averageBody =
      average(bodySamples);

    var currentBody =
      body(currentCandle);

    var displacement =
      averageBody > 0 &&
      currentBody >=
        averageBody * 1.5;

    var displacementDirection =
      "NONE";

    if (
      displacement &&
      bullish(currentCandle)
    ) {
      displacementDirection =
        "BULLISH";
    }

    if (
      displacement &&
      bearish(currentCandle)
    ) {
      displacementDirection =
        "BEARISH";
    }

    // ==============================
    // 13. MOMENTUM
    // ==============================

    var recent = candles.slice(-10);

    var bullCount = 0;
    var bearCount = 0;

    for (
      var mi = 0;
      mi < recent.length;
      mi++
    ) {
      if (bullish(recent[mi])) {
        bullCount++;
      }

      if (bearish(recent[mi])) {
        bearCount++;
      }
    }

    var momentum = "NEUTRAL";

    if (bullCount >= 6) {
      momentum = "BULLISH";
    }

    if (bearCount >= 6) {
      momentum = "BEARISH";
    }

    // ==============================
    // 14. CONFLUENCE
    // ==============================

    var bullishScore = 0;
    var bearishScore = 0;

    var bullishReasons = [];
    var bearishReasons = [];

    if (
      marketStructure ===
      "BULLISH"
    ) {
      bullishScore += 25;
      bullishReasons.push(
        "Bullish market structure"
      );
    }

    if (
      marketStructure ===
      "BEARISH"
    ) {
      bearishScore += 25;
      bearishReasons.push(
        "Bearish market structure"
      );
    }

    if (
      latestBOS &&
      latestBOS.type ===
        "BULLISH_BOS"
    ) {
      bullishScore += 20;
      bullishReasons.push(
        "Bullish BOS"
      );
    }

    if (
      latestBOS &&
      latestBOS.type ===
        "BEARISH_BOS"
    ) {
      bearishScore += 20;
      bearishReasons.push(
        "Bearish BOS"
      );
    }

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

    if (
      latestSweep &&
      latestSweep.type ===
        "SELL_SIDE_SWEEP"
    ) {
      bullishScore += 15;
      bullishReasons.push(
        "Sell-side liquidity sweep"
      );
    }

    if (
      latestSweep &&
      latestSweep.type ===
        "BUY_SIDE_SWEEP"
    ) {
      bearishScore += 15;
      bearishReasons.push(
        "Buy-side liquidity sweep"
      );
    }

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

    if (
      nearestFVG &&
      currentPrice >=
        nearestFVG.low &&
      currentPrice <=
        nearestFVG.high
    ) {
      if (
        nearestFVG.type ===
        "BULLISH_FVG"
      ) {
        bullishScore += 10;
        bullishReasons.push(
          "Price inside bullish FVG"
        );
      }

      if (
        nearestFVG.type ===
        "BEARISH_FVG"
      ) {
        bearishScore += 10;
        bearishReasons.push(
          "Price inside bearish FVG"
        );
      }
    }

    if (
      nearestBullishOB &&
      currentPrice >=
        nearestBullishOB.low &&
      currentPrice <=
        nearestBullishOB.high
    ) {
      bullishScore += 10;
      bullishReasons.push(
        "Price inside bullish OB"
      );
    }

    if (
      nearestBearishOB &&
      currentPrice >=
        nearestBearishOB.low &&
      currentPrice <=
        nearestBearishOB.high
    ) {
      bearishScore += 10;
      bearishReasons.push(
        "Price inside bearish OB"
      );
    }

    if (
      displacementDirection ===
      "BULLISH"
    ) {
      bullishScore += 5;
      bullishReasons.push(
        "Bullish displacement"
      );
    }

    if (
      displacementDirection ===
      "BEARISH"
    ) {
      bearishScore += 5;
      bearishReasons.push(
        "Bearish displacement"
      );
    }

    if (
      momentum === "BULLISH"
    ) {
      bullishScore += 5;
      bullishReasons.push(
        "Bullish momentum"
      );
    }

    if (
      momentum === "BEARISH"
    ) {
      bearishScore += 5;
      bearishReasons.push(
        "Bearish momentum"
      );
    }

    // ==============================
    // 15. BIAS
    // ==============================

    var bias = "NEUTRAL";

    if (
      bullishScore >= 60 &&
      bullishScore >
        bearishScore + 15
    ) {
      bias = "BUY";
    }

    if (
      bearishScore 
