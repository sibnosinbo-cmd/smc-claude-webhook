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
        error: "Not enough candles"
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

    function round(n) {
      return Math.round(n * 100000) / 100000;
    }

    function highest(arr) {
      var x = -Infinity;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].high > x) x = arr[i].high;
      }
      return x;
    }

    function lowest(arr) {
      var x = Infinity;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].low < x) x = arr[i].low;
      }
      return x;
    }

    function body(c) {
      return Math.abs(c.close - c.open);
    }

    var current = candles[candles.length - 1];
    var price = current.close;

    // ==========================================
    // 1. DEALING RANGE
    // ==========================================

    var range = candles.slice(-150);

    var rangeHigh = highest(range);
    var rangeLow = lowest(range);

    var equilibrium =
      (rangeHigh + rangeLow) / 2;

    var zone = "EQUILIBRIUM";

    if (price > equilibrium) zone = "PREMIUM";
    if (price < equilibrium) zone = "DISCOUNT";

    // ==========================================
    // 2. SWINGS
    // ==========================================

    var highs = [];
    var lows = [];

    for (var i = 3; i < candles.length - 3; i++) {

      if (
        candles[i].high > candles[i - 1].high &&
        candles[i].high > candles[i - 2].high &&
        candles[i].high > candles[i - 3].high &&
        candles[i].high > candles[i + 1].high &&
        candles[i].high > candles[i + 2].high &&
        candles[i].high > candles[i + 3].high
      ) {
        highs.push({
          index: i,
          price: candles[i].high,
          datetime: candles[i].datetime
        });
      }

      if (
        candles[i].low < candles[i - 1].low &&
        candles[i].low < candles[i - 2].low &&
        candles[i].low < candles[i - 3].low &&
        candles[i].low < candles[i + 1].low &&
        candles[i].low < candles[i + 2].low &&
        candles[i].low < candles[i + 3].low
      ) {
        lows.push({
          index: i,
          price: candles[i].low,
          datetime: candles[i].datetime
        });
      }
    }

    var lastHigh = highs.length
      ? highs[highs.length - 1]
      : null;

    var previousHigh =
      highs.length > 1
        ? highs[highs.length - 2]
        : null;

    var lastLow = lows.length
      ? lows[lows.length - 1]
      : null;

    var previousLow =
      lows.length > 1
        ? lows[lows.length - 2]
        : null;

    // ==========================================
    // 3. MARKET STRUCTURE
    // ==========================================

    var structure = "NEUTRAL";

    if (
      lastHigh &&
      previousHigh &&
      lastLow &&
      previousLow
    ) {
      var HH =
        lastHigh.price > previousHigh.price;

      var HL =
        lastLow.price > previousLow.price;

      var LH =
        lastHigh.price < previousHigh.price;

      var LL =
        lastLow.price < previousLow.price;

      if (HH && HL) {
        structure = "BULLISH";
      } else if (LH && LL) {
        structure = "BEARISH";
      } else {
        structure = "TRANSITION";
      }
    }

    // ==========================================
    // 4. BOS + CHOCH
    // ==========================================

    var bos = null;

    for (var b = 20; b < candles.length; b++) {

      var previousCandles =
        candles.slice(b - 20, b);

      var h = highest(previousCandles);
      var l = lowest(previousCandles);

      if (candles[b].close > h) {
        bos = {
          type: "BULLISH_BOS",
          price: candles[b].close,
          datetime: candles[b].datetime,
          brokenLevel: h
        };
      }

      if (candles[b].close < l) {
        bos = {
          type: "BEARISH_BOS",
          price: candles[b].close,
          datetime: candles[b].datetime,
          brokenLevel: l
        };
      }
    }

    var choch = null;

    if (
      structure === "BULLISH" &&
      bos &&
      bos.type === "BEARISH_BOS"
    ) {
      choch = "BEARISH_CHOCH";
    }

    if (
      structure === "BEARISH" &&
      bos &&
      bos.type === "BULLISH_BOS"
    ) {
      choch = "BULLISH_CHOCH";
    }

    // ==========================================
    // 5. LIQUIDITY SWEEP
    // ==========================================

    var sweep = null;

    for (var s = 10; s < candles.length; s++) {

      var previous10 =
        candles.slice(s - 10, s);

      var ph = highest(previous10);
      var pl = lowest(previous10);

      if (
        candles[s].high > ph &&
        candles[s].close < ph
      ) {
        sweep = {
          type: "BUY_SIDE_SWEEP",
          price: candles[s].high,
          datetime: candles[s].datetime
        };
      }

      if (
        candles[s].low < pl &&
        candles[s].close > pl
      ) {
        sweep = {
          type: "SELL_SIDE_SWEEP",
          price: candles[s].low,
          datetime: candles[s].datetime
        };
      }
    }

    // ==========================================
    // 6. DISPLACEMENT
    // ==========================================

    var bodies = [];

    for (
      var d = candles.length - 31;
      d < candles.length - 1;
      d++
    ) {
      if (d >= 0) {
        bodies.push(body(candles[d]));
      }
    }

    var averageBody = 0;

    if (bodies.length) {
      for (var ab = 0; ab < bodies.length; ab++) {
        averageBody += bodies[ab];
      }

      averageBody =
        averageBody / bodies.length;
    }

    var currentBody = body(current);

    var displacement =
      averageBody > 0 &&
      currentBody >= averageBody * 1.5;

    var displacementDirection = "NONE";

    if (displacement && current.close > current.open) {
      displacementDirection = "BULLISH";
    }

    if (displacement && current.close < current.open) {
      displacementDirection = "BEARISH";
    }

    // ==========================================
    // 7. FVG
    // ==========================================

    var fvgs = [];

    for (var f = 2; f < candles.length; f++) {

      var left = candles[f - 2];
      var right = candles[f];

      if (left.high < right.low) {
        fvgs.push({
          type: "BULLISH_FVG",
          low: left.high,
          high: right.low,
          midpoint:
            (left.high + right.low) / 2,
          index: f
        });
      }

      if (left.low > right.high) {
        fvgs.push({
          type: "BEARISH_FVG",
          low: right.high,
          high: left.low,
          midpoint:
            (right.high + left.low) / 2,
          index: f
        });
      }
    }

    var activeFVGs = [];

    for (var fi = 0; fi < fvgs.length; fi++) {

      var gap = fvgs[fi];
      var filled = false;

      for (
        var fc = gap.index + 1;
        fc < candles.length;
        fc++
      ) {
        if (
          candles[fc].low <= gap.low &&
          candles[fc].high >= gap.high
        ) {
          filled = true;
          break;
        }
      }

      if (!filled) {
        activeFVGs.push(gap);
      }
    }

    var nearestFVG = null;
    var nearestDistance = Infinity;

    for (var nf = 0; nf < activeFVGs.length; nf++) {

      var gap2 = activeFVGs[nf];

      var dist = Math.abs(
        price - gap2.midpoint
      );

      if (
        price >= gap2.low &&
        price <= gap2.high
      ) {
        dist = 0;
      }

      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestFVG = gap2;
      }
    }

    // ==========================================
    // 8. ORDER BLOCK
    // ==========================================

    var orderBlock = null;

    if (bos) {

      var start =
        Math.max(0, candles.length - 20);

      for (
        var ob = candles.length - 2;
        ob >= start;
        ob--
      ) {

        var c = candles[ob];

        if (
          bos.type === "BULLISH_BOS" &&
          c.close < c.open
        ) {
          orderBlock = {
            type: "BULLISH_OB",
            low: c.low,
            high: c.high,
            datetime: c.datetime
          };
          break;
        }

        if (
          bos.type === "BEARISH_BOS" &&
          c.close > c.open
        ) {
          orderBlock = {
            type: "BEARISH_OB",
            low: c.low,
            high: c.high,
            datetime: c.datetime
          };
          break;
        }
      }
    }

    // ==========================================
    // 9. SCORING ENGINE
    // ==========================================

    var buyScore = 0;
    var sellScore = 0;

    var buyReasons = [];
    var sellReasons = [];

    if (structure === "BULLISH") {
      buyScore += 20;
      buyReasons.push("Bullish structure");
    }

    if (structure === "BEARISH") {
      sellScore += 20;
      sellReasons.push("Bearish structure");
    }

    if (
      bos &&
      bos.type === "BULLISH_BOS"
    ) {
      buyScore += 20;
      buyReasons.push("Bullish BOS");
    }

    if (
      bos &&
      bos.type === "BEARISH_BOS"
    ) {
      sellScore += 20;
      sellReasons.push("Bearish BOS");
    }

    if (choch === "BULLISH_CHOCH") {
      buyScore += 20;
      buyReasons.push("Bullish CHOCH");
    }

    if (choch === "BEARISH_CHOCH") {
      sellScore += 20;
      sellReasons.push("Bearish CHOCH");
    }

    if (
      sweep &&
      sweep.type === "SELL_SIDE_SWEEP"
    ) {
      buyScore += 20;
      buyReasons.push("Sell-side liquidity sweep");
    }

    if (
      sweep &&
      sweep.type === "BUY_SIDE_SWEEP"
    ) {
      sellScore += 20;
      sellReasons.push("Buy-side liquidity sweep");
    }

    if (zone === "DISCOUNT") {
      buyScore += 10;
      buyReasons.push("Discount");
    }

    if (zone === "PREMIUM") {
      sellScore += 10;
      sellReasons.push("Premium");
    }

    if (
      displacementDirection === "BULLISH"
    ) {
      buyScore += 10;
      buyReasons.push("Bullish displacement");
    }

    if (
      displacementDirection === "BEARISH"
    ) {
      sellScore += 10;
      sellReasons.push("Bearish displacement");
    }

    if (
      nearestFVG &&
      price >= nearestFVG.low &&
      price <= nearestFVG.high
    ) {

      if (
        nearestFVG.type === "BULLISH_FVG"
      ) {
        buyScore += 15;
        buyReasons.push("Bullish FVG");
      }

      if (
        nearestFVG.type === "BEARISH_FVG"
      ) {
        sellScore += 15;
        sellReasons.push("Bearish FVG");
      }
    }

    if (
      orderBlock &&
      price >= orderBlock.low &&
      price <= orderBlock.high
    ) {

      if (
        orderBlock.type === "BULLISH_OB"
      ) {
        buyScore += 15;
        buyReasons.push("Bullish Order Block");
      }

      if (
        orderBlock.type === "BEARISH_OB"
      ) {
        sellScore += 15;
        sellReasons.push("Bearish Order Block");
      }
    }

    // ==========================================
    // 10. SIGNAL FILTER
    // ==========================================

    var signal = "WAIT";
    var bias = "NEUTRAL";

    var difference =
      Math.abs(buyScore - sellScore);

    if (
      buyScore >= 65 &&
      buyScore > sellScore &&
      difference >= 15
    ) {
      signal = "BUY";
      bias = "BULLISH";
    }

    if (
      sellScore >= 65 &&
      sellScore > buyScore &&
      difference >= 15
    ) {
      signal = "SELL";
      bias = "BEARISH";
    }

    var confidence =
      Math.min(
        100,
        Math.max(
          buyScore,
          sellScore
        )
      );

    // ==========================================
    // 11. TRADE PLAN
    // ==========================================

    var entry = null;
    var stopLoss = null;
    var takeProfit = null;

    if (signal === "BUY") {

      entry = price;

      if (orderBlock &&
          orderBlock.type === "BULLISH_OB") {
        stopLoss = orderBlock.low;
      } else if (lastLow) {
        stopLoss = lastLow.price;
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

      if (orderBlock &&
          orderBlock.type === "BEARISH_OB") {
        stopLoss = orderBlock.high;
      } else if (lastHigh) {
        stopLoss = lastHigh.price;
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

    if (
      entry !== null &&
      stopLoss !== null &&
      takeProfit !== null
    ) {

      if (
        signal === "BUY" &&
        takeProfit <= entry
      ) {
        signal = "WAIT";
      }

      if (
        signal === "SELL" &&
        takeProfit >= entry
      ) {
        signal = "WAIT";
      }
    }

    // ==========================================
    // FINAL RESPONSE
    // ==========================================

    return res.status(200).json({

      success: true,

      analyzer: "SMC Analyzer V4",

      version: "4.0",

      symbol: "XAU/USD",

      timeframe: "5min",

      timestamp:
        new Date().toISOString(),

      market: {
        price: round(price),
        rangeHigh: round(rangeHigh),
        rangeLow: round(rangeLow),
        equilibrium: round(equilibrium),
        zone: zone
      },

      structure: {
        marketStructure: structure,

        swingHigh:
          lastHigh
            ? round(lastHigh.price)
            : null,

        swingLow:
          lastLow
            ? round(lastLow.price)
            : null,

        BOS:
          bos
            ? {
                type: bos.type,
                price: round(bos.price),
                brokenLevel:
                  round(bos.brokenLevel),
                datetime: bos.datetime
              }
            : null,

        CHOCH: choch
      },

      liquidity: {
        latestSweep:
          sweep
            ? {
                type: sweep.type,
                price: round(sweep.price),
                datetime: sweep.datetime
              }
            : null
      },

      displacement: {
        detected: displacement,
        direction: displacementDirection,
        currentBody: round(currentBody),
        averageBody: round(averageBody)
      },

      FVG: {
        activeCount: activeFVGs.length,

        nearest:
          nearestFVG
            ? {
                type: nearestFVG.type,
                low: round(nearestFVG.low),
                high: round(nearestFVG.high),
                midpoint:
                  round(nearestFVG.midpoint)
              }
            : null
      },

      orderBlock:
        orderBlock
          ? {
              type: orderBlock.type,
              low: round(orderBlock.low),
              high: round(orderBlock.high),
              datetime:
                orderBlock.datetime
            }
          : null,

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
