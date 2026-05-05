const LAST_FM_KEY = "00f8809804f6b5907bac90edfd69fd0d";

export default async function handler(req, res) {
  const { artist } = req.query;
  if (!artist) return res.status(400).json({ error: "artist required" });

  try {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTags` +
      `&artist=${encodeURIComponent(artist)}` +
      `&api_key=${LAST_FM_KEY}&format=json&autocorrect=1`;
    const r = await fetch(url, {
      headers: { "User-Agent": "KeySync/1.0 (erahimlif@gmail.com)" },
    });
    return res.status(200).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
