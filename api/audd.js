export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  const apiKey = process.env.AUDD_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AUDD_API_KEY not set" });

  const body = new URLSearchParams({
    url,
    return: "deezer,apple_music",
    api_token: apiKey,
  });

  try {
    const upstream = await fetch("https://api.audd.io/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
