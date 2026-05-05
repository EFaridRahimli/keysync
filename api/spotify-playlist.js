export default async function handler(req, res) {
  const { playlistId, offset } = req.query;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();

  if (!playlistId || !token) {
    return res.status(400).json({ error: "missing playlistId or token" });
  }

  try {
    const isFirstPage = !offset || offset === "0";

    // First page: fetch full playlist to get tracks.items inline (avoids /tracks 403)
    // Subsequent pages: use the dedicated tracks endpoint
    const url = isFirstPage
      ? `https://api.spotify.com/v1/playlists/${playlistId}?market=from_token&additional_types=track`
      : `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&offset=${offset}&market=from_token`;

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

    if (isFirstPage) {
      const tracksPage = data.tracks;
      if (!tracksPage || !Array.isArray(tracksPage.items)) {
        // Return a readable debug payload so the client error shows us the shape
        return res.status(200).json({
          items: [],
          next: null,
          total: 0,
          _debug: {
            msg: "tracks field missing or items not array",
            tracksType: typeof tracksPage,
            tracksKeys: tracksPage ? Object.keys(tracksPage) : null,
            dataKeys: Object.keys(data ?? {}),
          },
        });
      }
      return res.status(200).json(tracksPage);
    }

    return res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
