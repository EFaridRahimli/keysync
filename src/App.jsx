import { useState, useCallback, useEffect } from "react";

const CLIENT_ID = "ca3f485852fc46b891cbd34d7d700f4c";
const REDIRECT_URI = window.location.origin;
const SCOPES = "user-library-read user-top-read user-read-recently-played";

// ─── Spotify key map ──────────────────────────────────────────────────────────
const KEY_NAMES = [
  "C",
  "C♯/D♭",
  "D",
  "D♯/E♭",
  "E",
  "F",
  "F♯/G♭",
  "G",
  "G♯/A♭",
  "A",
  "A♯/B♭",
  "B",
];
const MODE_NAMES = { 0: "Minor", 1: "Major" };
function keyLabel(key, mode) {
  if (key === -1) return "Unknown";
  return `${KEY_NAMES[key]} ${MODE_NAMES[mode] ?? ""}`.trim();
}
const CAMELOT = {
  "C Major": "8B",
  "A Minor": "8A",
  "G Major": "9B",
  "E Minor": "9A",
  "D Major": "10B",
  "B Minor": "10A",
  "A Major": "11B",
  "F♯/G♭ Minor": "11A",
  "E Major": "12B",
  "C♯/D♭ Minor": "12A",
  "B Major": "1B",
  "G♯/A♭ Minor": "1A",
  "F♯/G♭ Major": "2B",
  "D♯/E♭ Minor": "2A",
  "C♯/D♭ Major": "3B",
  "A♯/B♭ Minor": "3A",
  "G♯/A♭ Major": "4B",
  "F Minor": "4A",
  "D♯/E♭ Major": "5B",
  "C Minor": "5A",
  "A♯/B♭ Major": "6B",
  "G Minor": "6A",
  "F Major": "7B",
  "D Minor": "7A",
};
function getCamelot(key, mode) {
  const label = `${KEY_NAMES[key] ?? ""} ${MODE_NAMES[mode] ?? ""}`.trim();
  return CAMELOT[label] ?? "?";
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function loginWithSpotify() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem("pkce_verifier", verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("pkce_verifier");
  if (!verifier)
    throw new Error("No PKCE verifier found. Please try logging in again.");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? "Token exchange failed",
    );
  }
  localStorage.removeItem("pkce_verifier");
  return data.access_token;
}

async function spotifyGet(endpoint, token) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── ReccoBeats lookup ───────────────────────────────────────────────────────
function reccoToTrack(t) {
  const spotifyId = t.href?.match(/track\/([A-Za-z0-9]+)/)?.[1] ?? t.id;
  return {
    id: spotifyId,
    name: t.trackTitle,
    artists: (t.artists ?? []).map((a) => ({
      name: a.name,
      id: a.href?.match(/artist\/([A-Za-z0-9]+)/)?.[1] ?? null,
    })),
    album: { images: [] },
    external_urls: { spotify: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : "" },
  };
}

async function reccoFeatures(spotifyIds) {
  if (!spotifyIds.length) return [];
  try {
    const params = new URLSearchParams();
    spotifyIds.forEach((id) => params.append("ids", id));
    const res = await fetch(`/api/reccobeats?action=features&${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.content ?? [];
  } catch {
    return [];
  }
}


// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("spotify_token") ?? "",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [audioFeatures, setAudioFeatures] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [error, setError] = useState("");
  const [bpmTolerance, setBpmTolerance] = useState(5);
  const [matchSource, setMatchSource] = useState("recommendations");
  const [trackGenres, setTrackGenres] = useState([]);
  const [filterByGenre, setFilterByGenre] = useState(false);

  // Handle PKCE callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setError("Spotify login failed: " + errorParam);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    if (code) {
      window.history.replaceState(null, "", window.location.pathname);
      let cancelled = false;
      exchangeCodeForToken(code)
        .then((t) => {
          if (cancelled) return;
          localStorage.setItem("spotify_token", t);
          setToken(t);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e.message);
        });
      return () => { cancelled = true; };
    }
  }, []);

  function logout() {
    localStorage.removeItem("spotify_token");
    setToken("");
    setSelectedTrack(null);
    setAudioFeatures(null);
    setMatches([]);
    setSearchResults([]);
    setTrackGenres([]);
  }

  const searchTracks = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");
    setSearchResults([]);
    setSelectedTrack(null);
    setAudioFeatures(null);
    setMatches([]);
    try {
      const data = await spotifyGet(
        `/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=10`,
        token,
      );
      setSearchResults(data.tracks.items);
    } catch (e) {
      setError(e.message);
      if (e.message.includes("401")) logout();
    } finally {
      setLoading(false);
    }
  }, [searchQuery, token]);

  const selectTrack = useCallback(
    async (track) => {
      setSelectedTrack(track);
      setSearchResults([]);
      setMatches([]);
      setError("");
      setLoading(true);
      try {
        const artistId = track.artists?.[0]?.id;
        const [[feat], artistData] = await Promise.all([
          reccoFeatures([track.id]),
          artistId
            ? spotifyGet(`/artists/${artistId}`, token).catch(() => null)
            : Promise.resolve(null),
        ]);
        setAudioFeatures(
          feat
            ? { key: feat.key, mode: feat.mode, tempo: feat.tempo }
            : { key: -1, mode: 0, tempo: 0 },
        );
        setTrackGenres(artistData?.genres ?? []);
      } catch (e) {
        setError("Couldn't fetch audio features: " + e.message);
        setAudioFeatures({ key: -1, mode: 0, tempo: 0 });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const findMatches = useCallback(async () => {
    if (!audioFeatures) return;
    setMatchLoading(true);
    setError("");
    setMatches([]);
    const hasAudio = audioFeatures.key !== -1;

    const spotifyIdFromHref = (href) =>
      href?.match(/track\/([A-Za-z0-9]+)/)?.[1] ?? null;

    const applyGenreFilter = async (list) => {
      if (!filterByGenre || !trackGenres.length) return list;
      const artistIds = [...new Set(list.map((t) => t.artists?.[0]?.id).filter(Boolean))];
      const genreMap = {};
      for (let i = 0; i < artistIds.length; i += 50) {
        const batch = artistIds.slice(i, i + 50);
        const data = await spotifyGet(`/artists?ids=${batch.join(",")}`, token).catch(() => null);
        (data?.artists ?? []).forEach((a) => { if (a) genreMap[a.id] = a.genres ?? []; });
      }
      return list.filter((t) => {
        const g = genreMap[t.artists?.[0]?.id] ?? [];
        return g.some((genre) => trackGenres.includes(genre));
      });
    };

    try {
      if (matchSource === "recommendations") {
        const params = new URLSearchParams({
          action: "recs",
          spotifyId: selectedTrack.id,
          size: 50,
        });
        if (hasAudio) {
          params.set("key", audioFeatures.key);
          params.set("mode", audioFeatures.mode);
        }
        if (audioFeatures.tempo > 0)
          params.set("tempo", Math.round(audioFeatures.tempo));

        const recData = await fetch(`/api/reccobeats?${params}`).then((r) =>
          r.json(),
        );
        const reccoTracks = (recData.content ?? []).filter(
          (t) => spotifyIdFromHref(t.href) !== selectedTrack.id,
        );
        const spotifyIds = reccoTracks
          .map((t) => spotifyIdFromHref(t.href))
          .filter(Boolean);

        const [spotifyTracks, featList] = await Promise.all([
          spotifyIds.length
            ? spotifyGet(`/tracks?ids=${spotifyIds.join(",")}`, token)
                .then((d) => d.tracks)
                .catch(() => reccoTracks.map(reccoToTrack))
            : Promise.resolve([]),
          reccoFeatures(spotifyIds),
        ]);

        const featMap = {};
        featList.forEach((f) => {
          const sid = spotifyIdFromHref(f.href);
          if (sid) featMap[sid] = f;
        });

        const enriched = (spotifyTracks ?? []).filter(Boolean);
        const genreFiltered = await applyGenreFilter(enriched);
        setMatches(
          genreFiltered.map((t) => {
            const feat = featMap[t.id] ?? null;
            const bpmDiff =
              feat?.tempo != null
                ? Math.round(Math.abs(feat.tempo - audioFeatures.tempo) * 10) / 10
                : null;
            return { track: t, features: feat, bpmDiff, isHalfDouble: false };
          }),
        );
        return;
      }

      // Library or top tracks
      let tracks = [];
      if (matchSource === "library") {
        let all = [];
        for (let offset = 0; offset < 200; offset += 50) {
          const data = await spotifyGet(
            `/me/tracks?limit=50&offset=${offset}`,
            token,
          );
          all = all.concat(data.items.map((i) => i.track));
          if (data.items.length < 50) break;
        }
        tracks = all;
      } else if (matchSource === "top") {
        const data = await spotifyGet(
          `/me/top/tracks?limit=50&time_range=long_term`,
          token,
        );
        tracks = data.items;
      }

      const candidates = tracks
        .filter((t) => t && t.id !== selectedTrack.id)
        .slice(0, 200);

      const genreCandidates = await applyGenreFilter(candidates);

      if (!hasAudio) {
        setMatches(
          genreCandidates.map((track) => ({
            track,
            features: null,
            bpmDiff: null,
            isHalfDouble: false,
          })),
        );
        return;
      }

      // Batch-fetch ReccoBeats audio features (40 Spotify IDs per call)
      const featMap = {};
      const BATCH = 40;
      for (let i = 0; i < genreCandidates.length; i += BATCH) {
        const ids = genreCandidates.slice(i, i + BATCH).map((t) => t.id);
        const feats = await reccoFeatures(ids);
        feats.forEach((f) => {
          const sid = spotifyIdFromHref(f.href);
          if (sid) featMap[sid] = f;
        });
      }

      const matched = [];
      for (const track of genreCandidates) {
        const feat = featMap[track.id];
        if (!feat || feat.key === -1) continue;
        if (feat.key !== audioFeatures.key || feat.mode !== audioFeatures.mode)
          continue;
        if (!feat.tempo) continue;
        const bpmDiff = Math.abs(feat.tempo - audioFeatures.tempo);
        const halfDouble =
          Math.abs(feat.tempo - audioFeatures.tempo * 2) <= bpmTolerance ||
          Math.abs(feat.tempo * 2 - audioFeatures.tempo) <= bpmTolerance;
        if (bpmDiff <= bpmTolerance || halfDouble) {
          matched.push({
            track,
            features: feat,
            bpmDiff: Math.round(bpmDiff * 10) / 10,
            isHalfDouble: bpmDiff > bpmTolerance && halfDouble,
          });
        }
      }
      matched.sort((a, b) => a.bpmDiff - b.bpmDiff);
      setMatches(matched);
    } catch (e) {
      setError(e.message);
      if (e.message.includes("401")) logout();
    } finally {
      setMatchLoading(false);
    }
  }, [audioFeatures, selectedTrack, token, bpmTolerance, matchSource, filterByGenre, trackGenres]);

  return (
    <div style={styles.root}>
      <div style={styles.bgGrid} />
      <div style={styles.bgGlow} />

      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>♪</span>
          <span style={styles.logoText}>KeySync</span>
        </div>
        <p style={styles.tagline}>Find tracks that mix harmonically</p>
        {token && (
          <button style={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        )}
      </header>

      <main style={styles.main}>
        {/* ── Login ── */}
        {!token && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Connect Spotify</h2>
            <p style={styles.cardDesc}>
              Log in with your Spotify account to get started.
            </p>
            {error && <p style={styles.error}>{error}</p>}
            <button style={styles.btnPrimary} onClick={loginWithSpotify}>
              Login with Spotify
            </button>
          </section>
        )}

        {/* ── Search ── */}
        {token && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Search a Track</h2>
            <div style={styles.inputRow}>
              <input
                style={styles.input}
                placeholder="Artist, song name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchTracks()}
              />
              <button
                style={styles.btnPrimary}
                onClick={searchTracks}
                disabled={loading}
              >
                {loading ? "…" : "Search"}
              </button>
            </div>
            {error && <p style={styles.error}>{error}</p>}
            {searchResults.length > 0 && (
              <ul style={styles.resultList}>
                {searchResults.map((t) => (
                  <li
                    key={t.id}
                    style={styles.resultItem}
                    onClick={() => selectTrack(t)}
                  >
                    <img
                      src={
                        t.album?.images?.[2]?.url ?? t.album?.images?.[0]?.url
                      }
                      alt=""
                      style={styles.thumb}
                    />
                    <div>
                      <div style={styles.trackName}>{t.name}</div>
                      <div style={styles.artistName}>
                        {t.artists.map((a) => a.name).join(", ")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Analyzing indicator ── */}
        {selectedTrack && loading && !audioFeatures && (
          <p style={{ color: "#1db954", textAlign: "center", marginTop: 8 }}>
            Fetching audio features…
          </p>
        )}

        {/* ── Selected Track ── */}
        {selectedTrack && audioFeatures && (
          <section style={styles.card}>
            <div style={styles.selectedTrackRow}>
              <img
                src={
                  selectedTrack.album?.images?.[1]?.url ??
                  selectedTrack.album?.images?.[0]?.url
                }
                alt=""
                style={styles.albumArt}
              />
              <div>
                <div style={styles.selectedTrackName}>{selectedTrack.name}</div>
                <div style={styles.selectedArtist}>
                  {selectedTrack.artists.map((a) => a.name).join(", ")}
                </div>
                <div style={styles.badgeRow}>
                  <span style={styles.badge}>
                    🎵 {keyLabel(audioFeatures.key, audioFeatures.mode)}
                  </span>
                  <span style={styles.badge}>
                    ⚡ {audioFeatures.tempo > 0 ? `${Math.round(audioFeatures.tempo)} BPM` : "BPM unknown"}
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      background: "#daeee3",
                      color: "#1a7a42",
                    }}
                  >
                    🎡 {getCamelot(audioFeatures.key, audioFeatures.mode)}
                  </span>
                </div>
              </div>
            </div>
            <div style={styles.controls}>
              <div style={styles.controlGroup}>
                <label style={styles.label}>
                  BPM Tolerance: ±{bpmTolerance}
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={bpmTolerance}
                  onChange={(e) => setBpmTolerance(Number(e.target.value))}
                  style={styles.slider}
                />
              </div>
              <div style={styles.controlGroup}>
                <label style={styles.label}>Search in</label>
                <div style={styles.radioGroup}>
                  {[
                    { val: "recommendations", label: "Recommendations" },
                    { val: "library", label: "Your Library" },
                    { val: "top", label: "Your Top Tracks" },
                  ].map(({ val, label }) => (
                    <label key={val} style={styles.radioLabel}>
                      <input
                        type="radio"
                        name="source"
                        value={val}
                        checked={matchSource === val}
                        onChange={() => setMatchSource(val)}
                        style={{ accentColor: "#1db954" }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={styles.controlGroup}>
                <label style={styles.label}>Filters</label>
                <label style={styles.radioLabel}>
                  <input
                    type="checkbox"
                    checked={filterByGenre}
                    onChange={(e) => setFilterByGenre(e.target.checked)}
                    style={{ accentColor: "#1db954" }}
                  />
                  Same genre only
                  {trackGenres.length > 0 && (
                    <span style={{ color: "#9e9890", fontSize: "11px", marginLeft: "6px" }}>
                      ({trackGenres.slice(0, 2).join(", ")}{trackGenres.length > 2 ? "…" : ""})
                    </span>
                  )}
                </label>
              </div>
              <button
                style={styles.btnPrimary}
                onClick={findMatches}
                disabled={matchLoading}
              >
                {matchLoading ? "Analyzing audio…" : "Find Harmonic Matches"}
              </button>
            </div>
          </section>
        )}

        {/* ── Matches ── */}
        {matches.length > 0 && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>
              {matches.length} Harmonic Match{matches.length !== 1 ? "es" : ""}
            </h2>
            <p style={styles.cardDesc}>
              All tracks in{" "}
              <strong>{keyLabel(audioFeatures.key, audioFeatures.mode)}</strong>{" "}
              within ±{bpmTolerance} BPM of{" "}
              <strong>{Math.round(audioFeatures.tempo)} BPM</strong>
            </p>
            <ul style={styles.matchList}>
              {matches.map(({ track, features, bpmDiff, isHalfDouble }) => (
                <li key={track.id} style={styles.matchItem}>
                  {track.album?.images?.[0]?.url && (
                    <img
                      src={
                        track.album?.images?.[2]?.url ??
                        track.album?.images?.[0]?.url
                      }
                      alt=""
                      style={styles.thumb}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={styles.trackName}>{track.name}</div>
                    <div style={styles.artistName}>
                      {track.artists.map((a) => a.name).join(", ")}
                    </div>
                  </div>
                  {features && (
                    <div style={styles.matchMeta}>
                      <span style={styles.matchBadge}>
                        {Math.round(features.tempo)} BPM
                      </span>
                      <span
                        style={{
                          ...styles.matchBadge,
                          opacity: 0.6,
                          fontSize: "11px",
                        }}
                      >
                        {isHalfDouble ? "½×/2×" : `Δ${bpmDiff}`}
                      </span>
                    </div>
                  )}
                  <a
                    href={track.external_urls?.spotify}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.spotifyBtn}
                  >
                    ▶
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {matches.length === 0 &&
          !matchLoading &&
          audioFeatures &&
          selectedTrack && (
            <p style={{ color: "#9e9890", textAlign: "center", marginTop: 8 }}>
              No matches yet — hit "Find Harmonic Matches" above.
            </p>
          )}
      </main>

      <footer style={styles.footer}>
        KeySync — harmonic mixing helper
      </footer>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: "#f7f4ef",
    color: "#2c2c2c",
    fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    fontWeight: 300,
    overflowX: "hidden",
  },
  bgGrid: { display: "none" },
  bgGlow: { display: "none" },
  header: {
    textAlign: "center",
    padding: "56px 20px 28px",
    borderBottom: "1px solid #e8e4dd",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "6px",
  },
  logoIcon: { fontSize: "22px", color: "#1db954" },
  logoText: {
    fontSize: "28px",
    fontWeight: 300,
    letterSpacing: "0.05em",
    color: "#2c2c2c",
  },
  tagline: {
    color: "#b0a898",
    fontSize: "11px",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    margin: 0,
    fontWeight: 300,
  },
  logoutBtn: {
    marginTop: "14px",
    background: "transparent",
    border: "1px solid #d8d3cb",
    color: "#9e9890",
    borderRadius: "4px",
    padding: "4px 14px",
    fontSize: "11px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 300,
    letterSpacing: "0.05em",
  },
  main: {
    maxWidth: "620px",
    margin: "0 auto",
    padding: "32px 20px 80px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    background: "#f2efe9",
    border: "1px solid #e8e4dd",
    borderRadius: "8px",
    padding: "24px",
  },
  cardTitle: {
    margin: "0 0 6px",
    fontSize: "13px",
    fontWeight: 400,
    color: "#2c2c2c",
    letterSpacing: "0.05em",
  },
  cardDesc: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#b0a898",
    lineHeight: "1.6",
    fontWeight: 300,
  },
  inputRow: { display: "flex", gap: "8px" },
  input: {
    flex: 1,
    background: "#ece8e1",
    border: "1px solid #dedad2",
    borderRadius: "4px",
    padding: "9px 13px",
    color: "#2c2c2c",
    fontSize: "13px",
    outline: "none",
    fontFamily: "inherit",
    fontWeight: 300,
  },
  btnPrimary: {
    background: "#3a3a3a",
    color: "#f7f4ef",
    border: "none",
    borderRadius: "4px",
    padding: "9px 20px",
    fontWeight: 400,
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "0.08em",
    fontFamily: "inherit",
  },
  error: {
    color: "#b84c4c",
    fontSize: "12px",
    marginTop: "10px",
    background: "#f5eeee",
    border: "1px solid #e8d8d8",
    padding: "8px 12px",
    borderRadius: "4px",
    marginBottom: "12px",
    fontWeight: 300,
  },
  resultList: {
    listStyle: "none",
    margin: "14px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "9px 10px",
    borderRadius: "4px",
    cursor: "pointer",
    border: "1px solid transparent",
  },
  thumb: {
    width: "38px",
    height: "38px",
    borderRadius: "3px",
    objectFit: "cover",
    flexShrink: 0,
    background: "#e4e0d8",
  },
  trackName: { fontSize: "13px", color: "#2c2c2c", fontWeight: 400 },
  artistName: { fontSize: "12px", color: "#b0a898", marginTop: "2px", fontWeight: 300 },
  selectedTrackRow: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-start",
    marginBottom: "20px",
  },
  albumArt: {
    width: "64px",
    height: "64px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
    background: "#e4e0d8",
  },
  selectedTrackName: {
    fontSize: "16px",
    fontWeight: 400,
    color: "#2c2c2c",
    marginBottom: "3px",
  },
  selectedArtist: { fontSize: "12px", color: "#b0a898", marginBottom: "10px", fontWeight: 300 },
  badgeRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  badge: {
    background: "#ece8e1",
    border: "1px solid #dedad2",
    borderRadius: "3px",
    padding: "3px 10px",
    fontSize: "11px",
    color: "#6e6760",
    fontWeight: 300,
    letterSpacing: "0.03em",
  },
  controls: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    borderTop: "1px solid #e8e4dd",
    paddingTop: "20px",
  },
  controlGroup: { display: "flex", flexDirection: "column", gap: "8px" },
  label: {
    fontSize: "10px",
    color: "#b0a898",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 400,
  },
  slider: { accentColor: "#1db954", width: "100%", cursor: "pointer" },
  radioGroup: { display: "flex", gap: "16px", flexWrap: "wrap" },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    color: "#6e6760",
    cursor: "pointer",
    fontWeight: 300,
  },
  matchList: {
    listStyle: "none",
    margin: "14px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  matchItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "9px 10px",
    borderRadius: "4px",
    background: "#ece8e1",
    border: "1px solid #e2ddd5",
  },
  matchMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "3px",
    flexShrink: 0,
  },
  matchBadge: {
    background: "#e4e0d8",
    color: "#6e6760",
    borderRadius: "3px",
    padding: "2px 7px",
    fontSize: "11px",
    fontWeight: 400,
  },
  spotifyBtn: {
    background: "#1db954",
    color: "#fff",
    borderRadius: "50%",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    fontSize: "10px",
    flexShrink: 0,
    fontWeight: 600,
  },
  footer: {
    textAlign: "center",
    padding: "24px",
    fontSize: "11px",
    color: "#c4bfb6",
    fontWeight: 300,
    letterSpacing: "0.05em",
  },
  footerLink: {
    color: "#1db954",
    textDecoration: "none",
  },
};
