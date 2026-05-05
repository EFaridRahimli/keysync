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
      // Spotify's shape varies: tracks can be at data.tracks, data, or data.items (paging obj)
      const page = data.tracks ?? data;
      let trackItems, nextUrl, total;

      if (Array.isArray(page.items)) {
        // Standard shape: page.items is the array
        trackItems = page.items;
        nextUrl = page.next ?? null;
        total = page.total ?? page.items.length;
      } else if (page.items && Array.isArray(page.items.items)) {
        // Nested shape: page.items is itself a paging object
        trackItems = page.items.items;
        nextUrl = page.items.next ?? null;
        total = page.items.total ?? trackItems.length;
      } else {
        return res.status(200).json({
          items: [],
          next: null,
          total: 0,
          _debug: {
            msg: "could not locate track items",
            itemsType: typeof page.items,
            itemsIsNull: page.items === null,
            itemsKeys: page.items && typeof page.items === "object"
              ? Object.keys(page.items).slice(0, 8)
              : null,
          },
        });
      }

      return res.status(200).json({ items: trackItems, next: nextUrl, total });
    }

    return res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
