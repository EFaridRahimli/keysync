export default async function handler(req, res) {
  const { playlistId, offset } = req.query;
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!playlistId || !token) {
    return res.status(400).json({ error: "missing playlistId or token" });
  }

  try {
    const r = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50&offset=${offset || 0}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
