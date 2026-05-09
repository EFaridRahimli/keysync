import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import audd from './api/audd.js'
import deezer from './api/deezer.js'
import lastfm from './api/lastfm.js'
import reccobeats from './api/reccobeats.js'
import songbpm from './api/songbpm.js'
import spotifyPlaylist from './api/spotify-playlist.js'

const apiHandlers = {
  '/api/audd': audd,
  '/api/deezer': deezer,
  '/api/lastfm': lastfm,
  '/api/reccobeats': reccobeats,
  '/api/songbpm': songbpm,
  '/api/spotify-playlist': spotifyPlaylist,
}

function localApiPlugin() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        const handler = apiHandlers[requestUrl.pathname]

        if (!handler) {
          next()
          return
        }

        const query = {}
        for (const [key, value] of requestUrl.searchParams) {
          const existing = query[key]
          query[key] = existing === undefined ? value : [].concat(existing, value)
        }

        const apiRes = {
          status(code) {
            res.statusCode = code
            return this
          },
          json(payload) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json')
            }
            res.end(JSON.stringify(payload))
          },
        }

        try {
          await handler({ ...req, query }, apiRes)
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApiPlugin()],
})
