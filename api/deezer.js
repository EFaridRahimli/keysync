export default async function handler(req, res) {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json({ error: "title and artist are required" });
  }

  const q = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
