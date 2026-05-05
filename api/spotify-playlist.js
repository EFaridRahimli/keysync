export default async function handler(req, res) {
  const { playlistId, offset } = req.query;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();

  if (!playlistId || !token) {
    return res.status(400).json({ error: "missing playlistId or token" });
  }

  try {
    const isFirstPage = !offset || offset === "0";
    const url = isFirstPage
      ? `https://api.spotify.com/v1/playlists/${playlistId}?fields=tracks(items(track),next,total,offset,limit)`
      : `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&offset=${offset}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ...data,
        _debug: { url, tokenLen: token.length, tokenHead: token.slice(0, 8) },
      });
    }

    return res.status(200).json(isFirstPage ? (data.tracks ?? data) : data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
