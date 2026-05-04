export default async function handler(req, res) {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json({ error: "title and artist are required" });
  }

  try {
    const q = `track:"${title}" artist:"${artist}"`;
    const searchRes = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`,
    );
    const searchData = await searchRes.json();
    const items = searchData.data;
    if (!items?.length) return res.status(200).json({ data: [] });

    const track = items[0];
    const trackRes = await fetch(`https://api.deezer.com/track/${track.id}`);
    const trackData = await trackRes.json();

    res.status(200).json({
      data: [{ ...track, bpm: trackData.bpm ?? 0 }],
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
