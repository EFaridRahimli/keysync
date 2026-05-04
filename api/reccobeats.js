export default async function handler(req, res) {
  const { action } = req.query;
  const headers = { Accept: "application/json" };

  try {
    if (action === "features") {
      const ids = [].concat(req.query.ids ?? []);
      if (!ids.length) return res.status(400).json({ error: "ids required" });
      const params = new URLSearchParams();
      ids.forEach((id) => params.append("ids", id));
      const r = await fetch(
        `https://api.reccobeats.com/v1/audio-features?${params}`,
        { headers },
      );
      return res.status(200).json(await r.json());
    }

    if (action === "recs") {
      const { spotifyId, key, mode, tempo, size } = req.query;
      const params = new URLSearchParams({ seeds: spotifyId, size: size || 50 });
      if (key !== undefined && key !== "-1") params.set("key", key);
      if (mode !== undefined) params.set("mode", mode);
      if (tempo && parseFloat(tempo) > 0)
        params.set("tempo", Math.round(parseFloat(tempo)));
      const r = await fetch(
        `https://api.reccobeats.com/v1/track/recommendation?${params}`,
        { headers },
      );
      return res.status(200).json(await r.json());
    }

    return res.status(400).json({ error: "invalid action" });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
