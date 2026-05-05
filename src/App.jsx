import { useState, useCallback, useEffect } from "react";

const CLIENT_ID = "ca3f485852fc46b891cbd34d7d700f4c";
const REDIRECT_URI = window.location.origin;
const SCOPES = "user-library-read user-top-read user-read-recently-played playlist-read-private playlist-read-collaborative";

// ─── Spotify key map ──────────────────────────────────────────────────────────
const KEY_NAMES = ["C","C♯/D♭","D","D♯/E♭","E","F","F♯/G♭","G","G♯/A♭","A","A♯/B♭","B"];
const MODE_NAMES = { 0: "Minor", 1: "Major" };
function keyLabel(key, mode) {
  if (key === -1) return "Unknown";
  return `${KEY_NAMES[key]} ${MODE_NAMES[mode] ?? ""}`.trim();
}
const CAMELOT = {
  "C Major": "8B", "A Minor": "8A", "G Major": "9B", "E Minor": "9A",
  "D Major": "10B", "B Minor": "10A", "A Major": "11B", "F♯/G♭ Minor": "11A",
  "E Major": "12B", "C♯/D♭ Minor": "12A", "B Major": "1B", "G♯/A♭ Minor": "1A",
  "F♯/G♭ Major": "2B", "D♯/E♭ Minor": "2A", "C♯/D♭ Major": "3B", "A♯/B♭ Minor": "3A",
  "G♯/A♭ Major": "4B", "F Minor": "4A", "D♯/E♭ Major": "5B", "C Minor": "5A",
  "A♯/B♭ Major": "6B", "G Minor": "6A", "F Major": "7B", "D Minor": "7A",
};
function getCamelot(key, mode) {
  const label = `${KEY_NAMES[key] ?? ""} ${MODE_NAMES[mode] ?? ""}`.trim();
  return CAMELOT[label] ?? "?";
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function loginWithSpotify(forceDialog = false) {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem("pkce_verifier", verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI,
    scope: SCOPES, code_challenge_method: "S256", code_challenge: challenge,
  });
  if (forceDialog) params.set("show_dialog", "true");
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}
async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("pkce_verifier");
  if (!verifier) throw new Error("No PKCE verifier found. Please try logging in again.");
  const body = new URLSearchParams({
    client_id: CLIENT_ID, grant_type: "authorization_code",
    code, redirect_uri: REDIRECT_URI, code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? "Token exchange failed");
  localStorage.removeItem("pkce_verifier");
  localStorage.setItem("spotify_granted_scopes", data.scope ?? "");
  return data.access_token;
}

async function spotifyGet(endpoint, token) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err?.error?.message ?? `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// ─── ReccoBeats helpers ──────────────────────────────────────────────────────
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
  } catch (_e) {
    return [];
  }
}

// ─── Genre inference from audio features ─────────────────────────────────────
// ReccoBeats has no genre field, so we infer category from acoustic properties.
// This reliably separates hip-hop (high speechiness) from Disney/orchestral (low speechiness).
function inferGenreCategory(feat) {
  if (!feat) return null;
  const s = feat.speechiness ?? 0;
  const d = feat.danceability ?? 0;
  const a = feat.acousticness ?? 0;
  const e = feat.energy ?? 0;
  const inst = feat.instrumentalness ?? 0;
  const t = feat.tempo ?? 0;

  if (inst > 0.7) return "instrumental";
  if (s > 0.4) return "spoken";
  if (s > 0.15 && d > 0.4) return "rap";
  if (a > 0.7 && e < 0.5) return "acoustic";
  if (e > 0.78 && t > 118 && d > 0.65 && s < 0.09) return "edm";
  if (e > 0.68 && a < 0.25 && s < 0.1) return "rock";
  if (d > 0.6 && e > 0.45 && s < 0.12) return "pop";
  return "other";
}

const GENRE_LABELS = {
  rap: "Rap / Hip-Hop",
  spoken: "Spoken Word",
  acoustic: "Acoustic / Folk",
  edm: "Electronic",
  rock: "Rock",
  pop: "Pop / R&B",
  instrumental: "Instrumental",
  other: "Other",
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("spotify_token") ?? "");
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
  const [filterByGenre, setFilterByGenre] = useState(true);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState("");

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
      exchangeCodeForToken(code).then((t) => {
        if (cancelled) return;
        localStorage.setItem("spotify_token", t);
        setToken(t);
      }).catch((e) => { if (!cancelled) setError(e.message); });
      return () => { cancelled = true; };
    }
  }, []);

  useEffect(() => {
    if (!token || playlists.length > 0) return;
    let cancelled = false;
    setPlaylistLoading(true);
    (async () => {
      try {
        let all = [];
        let next = `/me/playlists?limit=50`;
        while (next && all.length < 200) {
          const data = await spotifyGet(next, token);
          all = all.concat(data.items.filter(Boolean));
          next = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
        }
        if (!cancelled) setPlaylists(all);
      } catch (e) {
        if (!cancelled) setPlaylistError(`List error ${e.status ?? "?"}: ${e.message}`);
      } finally {
        if (!cancelled) setPlaylistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, playlists.length]);

  useEffect(() => {
    if (!selectedPlaylist || !token) return;
    let cancelled = false;
    setPlaylistLoading(true);
    setPlaylistTracks([]);
    (async () => {
      try {
        let all = [];
        let offset = 0;
        while (all.length < 300) {
          const r = await fetch(
            `/api/spotify-playlist?playlistId=${selectedPlaylist.id}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${token.trim()}` } },
          );
          const data = await r.json();
          if (!r.ok) {
            const e = new Error(data?.error?.message ?? `HTTP ${r.status}`);
            e.status = r.status;
            throw e;
          }
          const items = (data.items ?? [])
            .map((i) => i.item ?? i.track ?? (i.id ? i : null))
            .filter(Boolean);
          all = all.concat(items);
          if (items.length < 50 || !data.next) break;
          offset += 50;
        }
        if (!cancelled) setPlaylistTracks(all);
      } catch (e) {
        if (!cancelled) {
          const granted = localStorage.getItem("spotify_granted_scopes") ?? "unknown";
          setPlaylistError(`Error ${e.status ?? "?"}: ${e.message} | granted scopes: ${granted}`);
        }
      } finally {
        if (!cancelled) setPlaylistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlaylist, token]);

  function logout() {
    localStorage.removeItem("spotify_token");
    setToken("");
    setSelectedTrack(null);
    setAudioFeatures(null);
    setMatches([]);
    setSearchResults([]);
    setTrackGenres([]);
    setPlaylists([]);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistError("");
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
        const featResult = await reccoFeatures([track.id]);
        const feat = featResult?.[0];
        setAudioFeatures(
          feat ? { key: feat.key, mode: feat.mode, tempo: feat.tempo } : { key: -1, mode: 0, tempo: 0 },
        );
        // Infer genre from ReccoBeats audio features (speechiness, danceability, etc.)
        const cat = inferGenreCategory(feat);
        setTrackGenres(cat ? [cat] : []);
      } catch (e) {
        setError("Couldn't fetch audio features: " + e.message);
        setAudioFeatures({ key: -1, mode: 0, tempo: 0 });
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
    const hasAudio = audioFeatures.key !== -1;
    const sourceCategory = trackGenres[0] ?? null;

    const spotifyIdFromHref = (href) => href?.match(/track\/([A-Za-z0-9]+)/)?.[1] ?? null;

    // Genre filter using inferred audio categories (no Spotify artist calls needed)
    const genreMatch = (feat) => {
      if (!filterByGenre || !sourceCategory) return true;
      const cat = inferGenreCategory(feat);
      if (!cat) return true;
      return cat === sourceCategory;
    };

    try {
      if (matchSource === "recommendations") {
        const params = new URLSearchParams({ action: "recs", spotifyId: selectedTrack.id, size: 50 });
        if (hasAudio) { params.set("key", audioFeatures.key); params.set("mode", audioFeatures.mode); }
        if (audioFeatures.tempo > 0) params.set("tempo", Math.round(audioFeatures.tempo));

        const recData = await fetch(`/api/reccobeats?${params}`).then((r) => r.json());
        const reccoTracks = (recData.content ?? []).filter(
          (t) => spotifyIdFromHref(t.href) !== selectedTrack.id,
        );
        const spotifyIds = reccoTracks.map((t) => spotifyIdFromHref(t.href)).filter(Boolean);

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
        const genreFiltered = enriched.filter((t) => genreMatch(featMap[t.id]));

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
          const data = await spotifyGet(`/me/tracks?limit=50&offset=${offset}`, token);
          all = all.concat(data.items.map((i) => i.track));
          if (data.items.length < 50) break;
        }
        tracks = all;
      } else if (matchSource === "top") {
        const data = await spotifyGet(`/me/top/tracks?limit=50&time_range=long_term`, token);
        tracks = data.items;
      }

      const candidates = tracks.filter((t) => t && t.id !== selectedTrack.id).slice(0, 200);

      // Fetch ReccoBeats features first so we can use them for genre AND key/tempo filtering
      const featMap = {};
      const BATCH = 40;
      for (let i = 0; i < candidates.length; i += BATCH) {
        const ids = candidates.slice(i, i + BATCH).map((t) => t.id);
        const feats = await reccoFeatures(ids);
        feats.forEach((f) => {
          const sid = spotifyIdFromHref(f.href);
          if (sid) featMap[sid] = f;
        });
      }

      const genreCandidates = candidates.filter((t) => genreMatch(featMap[t.id]));

      if (!hasAudio) {
        setMatches(
          genreCandidates.map((track) => ({ track, features: null, bpmDiff: null, isHalfDouble: false })),
        );
        return;
      }

      const matched = [];
      for (const track of genreCandidates) {
        const feat = featMap[track.id];
        if (!feat || feat.key === -1) continue;
        if (feat.key !== audioFeatures.key || feat.mode !== audioFeatures.mode) continue;
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

  const genreLabel = trackGenres.length > 0 ? (GENRE_LABELS[trackGenres[0]] ?? trackGenres[0]) : null;

  return (
    <div style={styles.root}>
      <div style={styles.bgGlow} />

      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>♪</span>
          <span style={styles.logoText}>KeySync</span>
        </div>
        <p style={styles.tagline}>Find tracks that mix harmonically</p>
        {token && (
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        )}
      </header>

      <main style={styles.main}>
        {/* ── Login ── */}
        {!token && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Connect Spotify</h2>
            <p style={styles.cardDesc}>Log in with your Spotify account to get started.</p>
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
              <button style={styles.btnPrimary} onClick={searchTracks} disabled={loading}>
                {loading ? "…" : "Search"}
              </button>
            </div>
            {error && <p style={styles.error}>{error}</p>}
            {searchResults.length > 0 && (
              <ul style={styles.resultList}>
                {searchResults.map((t) => (
                  <li key={t.id} style={styles.resultItem} onClick={() => selectTrack(t)}>
                    <img
                      src={t.album?.images?.[2]?.url ?? t.album?.images?.[0]?.url}
                      alt="" style={styles.thumb}
                    />
                    <div>
                      <div style={styles.trackName}>{t.name}</div>
                      <div style={styles.artistName}>{t.artists.map((a) => a.name).join(", ")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Playlist Browser ── */}
        {token && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Browse a Playlist</h2>
            <p style={styles.cardDesc}>Pick a playlist and tap a track to analyse it.</p>
            {playlistError === "reauth" ? (
              <div>
                <p style={{ fontSize: "13px", color: "#e07070", marginBottom: "8px" }}>
                  Playlist access was not granted.
                </p>
                <p style={{ fontSize: "12px", color: T.dim, marginBottom: "12px", lineHeight: "1.6" }}>
                  Go to <strong>spotify.com/account/apps</strong>, find this app and click <strong>Remove Access</strong>, then log in below.
                </p>
                <button style={styles.btnPrimary} onClick={() => { logout(); loginWithSpotify(true); }}>
                  Log in fresh
                </button>
              </div>
            ) : (
              <>
                {playlistLoading && playlists.length === 0 ? (
                  <span style={{ fontSize: "12px", color: T.dim }}>Loading your playlists…</span>
                ) : (
                  <select
                    style={{ ...styles.input, width: "100%", marginBottom: "12px" }}
                    value={selectedPlaylist?.id ?? ""}
                    onChange={(e) => {
                      setPlaylistError("");
                      setSelectedPlaylist(playlists.find((p) => p.id === e.target.value) ?? null);
                    }}
                  >
                    <option value="">Choose a playlist…</option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.owner?.display_name ?? p.owner?.id ?? "?"} ({p.items?.total ?? p.tracks?.total ?? "?"} tracks)
                      </option>
                    ))}
                  </select>
                )}
                {playlistError && (
                  <p style={{ fontSize: "12px", color: "#e07070", margin: "0 0 8px" }}>{playlistError}</p>
                )}
                {selectedPlaylist && playlistLoading && (
                  <p style={{ fontSize: "12px", color: T.dim, margin: 0 }}>Loading tracks…</p>
                )}
              </>
            )}
            {selectedPlaylist && !playlistLoading && playlistTracks.length === 0 && !playlistError && (
              <p style={{ fontSize: "12px", color: T.dim, margin: 0 }}>
                No tracks found. Open Spotify and make sure this playlist has songs added to it, then come back.
              </p>
            )}
            {selectedPlaylist && !playlistLoading && playlistTracks.length > 0 && (
              <ul style={{ ...styles.resultList, maxHeight: "320px", overflowY: "auto" }}>
                {playlistTracks.map((t) => (
                  <li key={t.id} style={styles.resultItem} onClick={() => selectTrack(t)}>
                    {t.album?.images?.[2]?.url && (
                      <img src={t.album.images[2].url} alt="" style={styles.thumb} />
                    )}
                    <div>
                      <div style={styles.trackName}>{t.name}</div>
                      <div style={styles.artistName}>{t.artists?.map((a) => a.name).join(", ")}</div>
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
                src={selectedTrack.album?.images?.[1]?.url ?? selectedTrack.album?.images?.[0]?.url}
                alt="" style={styles.albumArt}
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
                  <span style={{ ...styles.badge, background: "rgba(29,185,84,0.12)", color: "#1db954", border: "1px solid rgba(29,185,84,0.2)" }}>
                    🎡 {getCamelot(audioFeatures.key, audioFeatures.mode)}
                  </span>
                  {genreLabel && (
                    <span style={{ ...styles.badge, background: "rgba(130,100,200,0.15)", color: "#b8a0f0", border: "1px solid rgba(130,100,200,0.25)" }}>
                      {genreLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={styles.controls}>
              <div style={styles.controlGroup}>
                <label style={styles.label}>BPM Tolerance: ±{bpmTolerance}</label>
                <input
                  type="range" min={1} max={20} value={bpmTolerance}
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
                        type="radio" name="source" value={val}
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
                    type="checkbox" checked={filterByGenre}
                    onChange={(e) => setFilterByGenre(e.target.checked)}
                    style={{ accentColor: "#1db954" }}
                  />
                  Match genre
                  {genreLabel ? (
                    <span style={{ color: "#787ba0", fontSize: "11px", marginLeft: "6px" }}>
                      ({genreLabel})
                    </span>
                  ) : (
                    <span style={{ color: "#e07070", fontSize: "11px", marginLeft: "6px" }}>
                      (no genre detected — filter won't apply)
                    </span>
                  )}
                </label>
              </div>
              <button style={styles.btnPrimary} onClick={findMatches} disabled={matchLoading}>
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
              <strong style={{ color: T.text }}>{keyLabel(audioFeatures.key, audioFeatures.mode)}</strong>{" "}
              within ±{bpmTolerance} BPM of{" "}
              <strong style={{ color: T.text }}>{Math.round(audioFeatures.tempo)} BPM</strong>
            </p>
            <ul style={styles.matchList}>
              {matches.map(({ track, features, bpmDiff, isHalfDouble }) => (
                <li key={track.id} style={styles.matchItem}>
                  {track.album?.images?.[0]?.url && (
                    <img
                      src={track.album?.images?.[2]?.url ?? track.album?.images?.[0]?.url}
                      alt="" style={styles.thumb}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={styles.trackName}>{track.name}</div>
                    <div style={styles.artistName}>{track.artists.map((a) => a.name).join(", ")}</div>
                  </div>
                  {features && (
                    <div style={styles.matchMeta}>
                      <span style={styles.matchBadge}>{Math.round(features.tempo)} BPM</span>
                      <span style={{ ...styles.matchBadge, opacity: 0.6, fontSize: "11px" }}>
                        {isHalfDouble ? "½×/2×" : `Δ${bpmDiff}`}
                      </span>
                    </div>
                  )}
                  <a
                    href={track.external_urls?.spotify}
                    target="_blank" rel="noreferrer"
                    style={styles.spotifyBtn}
                  >
                    ▶
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {matches.length === 0 && !matchLoading && audioFeatures && selectedTrack && (
          <p style={{ color: T.dim, textAlign: "center", marginTop: 8 }}>
            No matches yet — hit "Find Harmonic Matches" above.
          </p>
        )}
      </main>

      <footer style={styles.footer}>KeySync — harmonic mixing helper</footer>
    </div>
  );
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:      "#1e2030",
  surface: "#252737",
  input:   "#191b27",
  text:    "#e8eaf2",
  dim:     "#787ba0",
  border:  "rgba(80,85,130,0.18)",
};

const neo = {
  raised: "5px 5px 14px rgba(0,0,0,0.55), -3px -3px 9px rgba(80,85,130,0.13)",
  inset:  "inset 3px 3px 8px rgba(0,0,0,0.5), inset -2px -2px 6px rgba(80,85,130,0.1)",
  soft:   "2px 2px 7px rgba(0,0,0,0.4), -1px -1px 5px rgba(80,85,130,0.09)",
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: T.bg,
    color: T.text,
    fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    fontWeight: 300,
    overflowX: "hidden",
    position: "relative",
  },
  bgGlow: {
    position: "fixed",
    inset: 0,
    background: [
      "radial-gradient(ellipse at 15% 15%, rgba(29,185,84,0.04) 0%, transparent 50%)",
      "radial-gradient(ellipse at 85% 80%, rgba(80,85,130,0.07) 0%, transparent 50%)",
    ].join(", "),
    pointerEvents: "none",
    zIndex: 0,
  },
  header: {
    textAlign: "center",
    padding: "52px 20px 26px",
    background: "rgba(25,27,39,0.92)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderBottom: `1px solid ${T.border}`,
    position: "relative",
    zIndex: 1,
  },
  logo: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "10px", marginBottom: "6px",
  },
  logoIcon: { fontSize: "22px", color: "#1db954" },
  logoText: { fontSize: "28px", fontWeight: 300, letterSpacing: "0.05em", color: T.text },
  tagline: {
    color: T.dim, fontSize: "11px", letterSpacing: "0.15em",
    textTransform: "uppercase", margin: 0, fontWeight: 300,
  },
  logoutBtn: {
    marginTop: "14px",
    background: "linear-gradient(145deg, #2c2e42, #1c1e2e)",
    border: T.border,
    color: T.dim, borderRadius: "8px", padding: "5px 16px",
    fontSize: "11px", cursor: "pointer", fontFamily: "inherit",
    fontWeight: 300, letterSpacing: "0.05em", boxShadow: neo.soft,
  },
  main: {
    maxWidth: "620px", margin: "0 auto", padding: "32px 20px 80px",
    display: "flex", flexDirection: "column", gap: "14px",
    position: "relative", zIndex: 1,
  },
  card: {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: "18px",
    padding: "26px",
    boxShadow: neo.raised,
  },
  cardTitle: {
    margin: "0 0 6px", fontSize: "13px", fontWeight: 500,
    color: T.text, letterSpacing: "0.05em",
  },
  cardDesc: {
    margin: "0 0 20px", fontSize: "13px", color: T.dim,
    lineHeight: "1.6", fontWeight: 300,
  },
  inputRow: { display: "flex", gap: "8px" },
  input: {
    flex: 1,
    background: T.input,
    border: `1px solid ${T.border}`,
    borderRadius: "10px",
    padding: "10px 14px",
    color: T.text,
    fontSize: "13px",
    outline: "none",
    fontFamily: "inherit",
    fontWeight: 300,
    boxShadow: neo.inset,
  },
  btnPrimary: {
    background: "linear-gradient(145deg, #2e3048, #1c1e2e)",
    color: T.text,
    border: `1px solid ${T.border}`,
    borderRadius: "10px",
    padding: "10px 22px",
    fontWeight: 400,
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "0.08em",
    fontFamily: "inherit",
    boxShadow: neo.raised,
  },
  error: {
    color: "#e07070", fontSize: "12px", marginTop: "10px",
    background: "rgba(60,20,20,0.8)",
    border: "1px solid rgba(200,80,80,0.2)",
    padding: "9px 13px", borderRadius: "10px",
    marginBottom: "12px", fontWeight: 300,
    boxShadow: neo.inset,
  },
  resultList: {
    listStyle: "none", margin: "14px 0 0", padding: 0,
    display: "flex", flexDirection: "column", gap: "4px",
  },
  resultItem: {
    display: "flex", alignItems: "center", gap: "12px",
    padding: "9px 11px", borderRadius: "10px", cursor: "pointer",
    border: `1px solid ${T.border}`,
    background: "linear-gradient(145deg, #2c2e42, #232535)",
    boxShadow: neo.soft,
    transition: "box-shadow 0.15s",
  },
  thumb: {
    width: "38px", height: "38px", borderRadius: "8px",
    objectFit: "cover", flexShrink: 0,
    background: T.input, boxShadow: neo.soft,
  },
  trackName: { fontSize: "13px", color: T.text, fontWeight: 400 },
  artistName: { fontSize: "12px", color: T.dim, marginTop: "2px", fontWeight: 300 },
  selectedTrackRow: {
    display: "flex", gap: "16px", alignItems: "flex-start", marginBottom: "20px",
  },
  albumArt: {
    width: "66px", height: "66px", borderRadius: "12px",
    objectFit: "cover", flexShrink: 0,
    background: T.input, boxShadow: neo.raised,
  },
  selectedTrackName: { fontSize: "16px", fontWeight: 400, color: T.text, marginBottom: "3px" },
  selectedArtist: { fontSize: "12px", color: T.dim, marginBottom: "10px", fontWeight: 300 },
  badgeRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  badge: {
    background: "linear-gradient(145deg, #2e3048, #232535)",
    border: `1px solid ${T.border}`,
    borderRadius: "8px", padding: "4px 11px",
    fontSize: "11px", color: T.dim,
    fontWeight: 300, letterSpacing: "0.03em",
    boxShadow: neo.soft,
  },
  controls: {
    display: "flex", flexDirection: "column", gap: "16px",
    borderTop: `1px solid ${T.border}`, paddingTop: "20px",
  },
  controlGroup: { display: "flex", flexDirection: "column", gap: "8px" },
  label: {
    fontSize: "10px", color: T.dim, letterSpacing: "0.12em",
    textTransform: "uppercase", fontWeight: 400,
  },
  slider: { accentColor: "#1db954", width: "100%", cursor: "pointer" },
  radioGroup: { display: "flex", gap: "16px", flexWrap: "wrap" },
  radioLabel: {
    display: "flex", alignItems: "center", gap: "6px",
    fontSize: "13px", color: T.dim, cursor: "pointer", fontWeight: 300,
  },
  matchList: {
    listStyle: "none", margin: "14px 0 0", padding: 0,
    display: "flex", flexDirection: "column", gap: "4px",
  },
  matchItem: {
    display: "flex", alignItems: "center", gap: "12px",
    padding: "10px 12px", borderRadius: "12px",
    background: "linear-gradient(145deg, #2c2e42, #232535)",
    border: `1px solid ${T.border}`,
    boxShadow: neo.soft,
  },
  matchMeta: {
    display: "flex", flexDirection: "column",
    alignItems: "flex-end", gap: "3px", flexShrink: 0,
  },
  matchBadge: {
    background: "linear-gradient(145deg, #2e3048, #232535)",
    border: `1px solid ${T.border}`,
    color: T.dim, borderRadius: "6px",
    padding: "2px 8px", fontSize: "11px",
    fontWeight: 400, boxShadow: neo.soft,
  },
  spotifyBtn: {
    background: "linear-gradient(145deg, #22d45f, #17a348)",
    color: "#fff", borderRadius: "50%",
    width: "30px", height: "30px",
    display: "flex", alignItems: "center", justifyContent: "center",
    textDecoration: "none", fontSize: "10px", flexShrink: 0,
    fontWeight: 600,
    boxShadow: "2px 2px 8px rgba(29,185,84,0.2), -1px -1px 4px rgba(80,85,130,0.08)",
  },
  footer: {
    textAlign: "center", padding: "24px", fontSize: "11px",
    color: "#404260", fontWeight: 300, letterSpacing: "0.05em",
    position: "relative", zIndex: 1,
  },
};
