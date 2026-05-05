export default async function handler(req, res) {
  const { playlistId, offset } = req.query;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();

  if (!playlistId || !token) {
    return res.status(400).json({ error: "missing playlistId or token" });
  }

  try {
    // /tracks is deprecated — use /items (the current endpoint)
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50&offset=${offset || 0}&market=from_token`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
