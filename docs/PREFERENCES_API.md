# User Preferences API

API endpoints for accessing user music preferences aggregated from internal lists, Spotify, and Last.fm.

All endpoints require authentication via session or bearer token.

## Overview Endpoints

### GET /api/preferences

Returns all preference data for the current user.

**Response:**

```json
{
  "success": true,
  "data": {
    "topGenres": [{ "name": "Rock", "count": 10, "points": 100 }],
    "topArtists": [{ "name": "Artist", "count": 5, "points": 80 }],
    "topCountries": [{ "name": "USA", "count": 8, "points": 90 }],
    "totalAlbums": 50,
    "spotify": {
      "topArtists": {},
      "topTracks": {},
      "savedAlbums": [],
      "syncedAt": "..."
    },
    "lastfm": {
      "topArtists": {},
      "topAlbums": {},
      "totalScrobbles": 5000,
      "syncedAt": "..."
    },
    "affinity": { "genres": [], "artists": [] }
  }
}
```

### GET /api/preferences/status

Returns sync status and whether data needs refresh.

### GET /api/preferences/summary

Returns lightweight summary (top 5 of each category).

## Sync Endpoints

### POST /api/preferences/sync

Manually trigger a full sync from all sources (Spotify, Last.fm, internal lists).

### POST /api/preferences/aggregate

Re-aggregate internal list data only (faster than full sync).

**Body:** `{ "officialOnly": false }` - optionally aggregate only official lists.

## Internal Data Endpoints

### GET /api/preferences/genres

Returns genre data from internal lists plus computed affinity scores.

### GET /api/preferences/artists

Returns artist data from all sources (internal, Spotify, Last.fm) plus affinity.

### GET /api/preferences/countries

Returns country distribution from internal lists.

## Spotify Endpoints

### GET /api/preferences/spotify

Returns all Spotify data (artists, tracks, saved albums).

### GET /api/preferences/spotify/artists

Returns Spotify top artists.

**Query params:** `?range=short_term|medium_term|long_term`

### GET /api/preferences/spotify/tracks

Returns Spotify top tracks.

**Query params:** `?range=short_term|medium_term|long_term`

### GET /api/preferences/spotify/albums

Returns Spotify saved albums (paginated).

**Query params:** `?limit=50&offset=0`

## Last.fm Endpoints

### GET /api/preferences/lastfm

Returns all Last.fm data (artists, albums, scrobble count).

### GET /api/preferences/lastfm/artists

Returns Last.fm top artists.

**Query params:** `?period=7day|1month|3month|6month|12month|overall`

### GET /api/preferences/lastfm/albums

Returns Last.fm top albums.

**Query params:** `?period=7day|1month|3month|6month|12month|overall`

## Affinity Endpoints

Affinity scores are computed by combining data from all sources with configurable weights (internal: 40%, Spotify: 35%, Last.fm: 25%).

### GET /api/preferences/affinity

Returns both genre and artist affinity scores.

### GET /api/preferences/affinity/genres

Returns genre affinity scores only.

**Query params:** `?limit=50` (max 100)

### GET /api/preferences/affinity/artists

Returns artist affinity scores only.

**Query params:** `?limit=50` (max 100)

**Response format:**

```json
{
  "data": [
    { "name": "Rock", "score": 0.95, "sources": ["internal", "spotify"] }
  ]
}
```

## Data Sources

| Source   | What it provides                                                       |
| -------- | ---------------------------------------------------------------------- |
| Internal | Genres, artists, countries from user's album lists (position-weighted) |
| Spotify  | Top artists/tracks (short/medium/long term), saved albums              |
| Last.fm  | Top artists/albums (multiple time periods), total scrobbles            |

## Background Sync

Preferences are automatically synced every 6 hours in production. Data older than 24 hours is considered stale and will be refreshed on the next sync cycle.
