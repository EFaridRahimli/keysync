export default async function handler(req, res) {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json({ error: "title and artist are required" });
  }

  const apiKey = process.env.GETSONGBPM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GETSONGBPM_API_KEY not set" });
  }

  const lookup = `${title} ${artist}`;
  const url = `https://api.getsongbpm.com/search/?api_key=${apiKey}&type=both&lookup=${encodeURIComponent(lookup)}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
