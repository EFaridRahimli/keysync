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
        `/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=8`,
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
        const features = await spotifyGet(`/audio-features/${track.id}`, token);
        setAudioFeatures(features);
      } catch (e) {
        setError("Couldn't fetch audio features: " + e.message);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const findMatches = useCallback(async () => {
    if (!audioFeatures) return;
    setMatchLoading(true);
    setError("");
    setMatches([]);
    try {
      let tracks = [];
      if (matchSource === "recommendations") {
        const data = await spotifyGet(
          `/recommendations?seed_tracks=${selectedTrack.id}&limit=100&target_tempo=${Math.round(audioFeatures.tempo)}&target_key=${audioFeatures.key}&target_mode=${audioFeatures.mode}`,
          token,
        );
        tracks = data.tracks;
      } else if (matchSource === "library") {
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

      const ids = tracks.map((t) => t.id).filter(Boolean);
      let allFeatures = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100).join(",");
        const data = await spotifyGet(`/audio-features?ids=${chunk}`, token);
        allFeatures = allFeatures.concat(data.audio_features ?? []);
      }

      const matched = [];
      for (let i = 0; i < tracks.length; i++) {
        const feat = allFeatures[i];
        if (!feat) continue;
        if (tracks[i].id === selectedTrack.id) continue;
        const sameKey =
          feat.key === audioFeatures.key && feat.mode === audioFeatures.mode;
        const bpmDiff = Math.abs(feat.tempo - audioFeatures.tempo);
        const halfDouble =
          Math.abs(feat.tempo - audioFeatures.tempo * 2) <= bpmTolerance ||
          Math.abs(feat.tempo * 2 - audioFeatures.tempo) <= bpmTolerance;
        if (sameKey && (bpmDiff <= bpmTolerance || halfDouble)) {
          matched.push({
            track: tracks[i],
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
  }, [audioFeatures, selectedTrack, token, bpmTolerance, matchSource]);

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
                    ⚡ {Math.round(audioFeatures.tempo)} BPM
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      background: "#1a3a2a",
                      color: "#1db954",
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
              <button
                style={styles.btnPrimary}
                onClick={findMatches}
                disabled={matchLoading}
              >
                {matchLoading ? "Scanning…" : "Find Harmonic Matches"}
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
                  <img
                    src={
                      track.album?.images?.[2]?.url ??
                      track.album?.images?.[0]?.url
                    }
                    alt=""
                    style={styles.thumb}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={styles.trackName}>{track.name}</div>
                    <div style={styles.artistName}>
                      {track.artists.map((a) => a.name).join(", ")}
                    </div>
                  </div>
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
            <p style={{ color: "#666", textAlign: "center", marginTop: 8 }}>
              No matches yet — hit "Find Harmonic Matches" above.
            </p>
          )}
      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e8e8f0",
    fontFamily: "'DM Mono', 'Courier New', monospace",
    position: "relative",
    overflowX: "hidden",
  },
  bgGrid: {
    position: "fixed",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(29,185,84,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(29,185,84,0.04) 1px, transparent 1px)",
    backgroundSize: "40px 40px",
    pointerEvents: "none",
    zIndex: 0,
  },
  bgGlow: {
    position: "fixed",
    top: "-20%",
    left: "50%",
    transform: "translateX(-50%)",
    width: "600px",
    height: "400px",
    background:
      "radial-gradient(ellipse, rgba(29,185,84,0.08) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  header: {
    textAlign: "center",
    padding: "48px 20px 24px",
    position: "relative",
    zIndex: 1,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    marginBottom: "8px",
  },
  logoIcon: { fontSize: "36px", color: "#1db954" },
  logoText: {
    fontSize: "36px",
    fontWeight: "700",
    letterSpacing: "-1px",
    color: "#fff",
  },
  tagline: {
    color: "#555",
    fontSize: "13px",
    letterSpacing: "2px",
    textTransform: "uppercase",
    margin: 0,
  },
  logoutBtn: {
    marginTop: "12px",
    background: "transparent",
    border: "1px solid #333",
    color: "#555",
    borderRadius: "6px",
    padding: "4px 12px",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  main: {
    maxWidth: "680px",
    margin: "0 auto",
    padding: "0 20px 60px",
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px",
    padding: "24px",
    backdropFilter: "blur(8px)",
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: "16px",
    fontWeight: "600",
    color: "#fff",
    letterSpacing: "0.5px",
  },
  cardDesc: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#666",
    lineHeight: "1.6",
  },
  inputRow: { display: "flex", gap: "10px" },
  input: {
    flex: 1,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#e8e8f0",
    fontSize: "14px",
    outline: "none",
    fontFamily: "inherit",
  },
  btnPrimary: {
    background: "#1db954",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "0.5px",
    fontFamily: "inherit",
  },
  error: {
    color: "#ff5f5f",
    fontSize: "13px",
    marginTop: "10px",
    background: "rgba(255,95,95,0.08)",
    padding: "8px 12px",
    borderRadius: "6px",
    marginBottom: "12px",
  },
  resultList: {
    listStyle: "none",
    margin: "16px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid transparent",
  },
  thumb: {
    width: "40px",
    height: "40px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
    background: "#222",
  },
  trackName: { fontSize: "14px", color: "#e8e8f0", fontWeight: "500" },
  artistName: { fontSize: "12px", color: "#666", marginTop: "2px" },
  selectedTrackRow: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-start",
    marginBottom: "20px",
  },
  albumArt: {
    width: "72px",
    height: "72px",
    borderRadius: "8px",
    objectFit: "cover",
    flexShrink: 0,
    background: "#1a1a1a",
  },
  selectedTrackName: {
    fontSize: "18px",
    fontWeight: "700",
    color: "#fff",
    marginBottom: "4px",
  },
  selectedArtist: { fontSize: "13px", color: "#888", marginBottom: "10px" },
  badgeRow: { display: "flex", gap: "8px", flexWrap: "wrap" },
  badge: {
    background: "#1a1a2e",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "20px",
    padding: "4px 12px",
    fontSize: "12px",
    color: "#c0c0d0",
    letterSpacing: "0.3px",
  },
  controls: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: "20px",
  },
  controlGroup: { display: "flex", flexDirection: "column", gap: "8px" },
  label: {
    fontSize: "12px",
    color: "#666",
    letterSpacing: "1px",
    textTransform: "uppercase",
  },
  slider: { accentColor: "#1db954", width: "100%", cursor: "pointer" },
  radioGroup: { display: "flex", gap: "16px", flexWrap: "wrap" },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    color: "#b0b0c0",
    cursor: "pointer",
  },
  matchList: {
    listStyle: "none",
    margin: "16px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  matchItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "rgba(29,185,84,0.04)",
    border: "1px solid rgba(29,185,84,0.1)",
  },
  matchMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "3px",
    flexShrink: 0,
  },
  matchBadge: {
    background: "rgba(29,185,84,0.15)",
    color: "#1db954",
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "12px",
    fontWeight: "600",
  },
  spotifyBtn: {
    background: "#1db954",
    color: "#000",
    borderRadius: "50%",
    width: "30px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    fontSize: "11px",
    flexShrink: 0,
    fontWeight: "bold",
  },
};
