export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("TradingView Alert:");
    console.log(req.body);

    return res.status(200).json({
      received: true
    });
  }

  return res.status(200).json({
    status: "online",
    service: "SMC Claude Webhook"
  });
}
