<p align="center">
  <img src="public/og-image.png" alt="SuShe Online" width="600" />
</p>

<h1 align="center">🤘 SuShe Online</h1>

<p align="center">
  <strong>A personal music collection manager with a dark aesthetic</strong>
</p>

<p align="center">
  <a href="https://github.com/magnusoverli/sushe-online/actions/workflows/docker-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/magnusoverli/sushe-online/docker-build.yml?branch=main&style=for-the-badge&logo=github-actions&logoColor=white&label=CI" alt="CI Status" /></a>
  <a href="https://github.com/magnusoverli/sushe-online/pkgs/container/sushe-online"><img src="https://img.shields.io/badge/ghcr.io-container-blue?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" /></a>
  <img src="https://img.shields.io/badge/node-24+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/code_style-prettier-ff69b4?style=for-the-badge&logo=prettier&logoColor=white" alt="Prettier" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome" />
  <a href="https://github.com/magnusoverli/sushe-online/commits/main"><img src="https://img.shields.io/github/last-commit/magnusoverli/sushe-online?style=for-the-badge&logo=github" alt="Last Commit" /></a>
  <a href="https://github.com/magnusoverli/sushe-online/stargazers"><img src="https://img.shields.io/github/stars/magnusoverli/sushe-online?style=for-the-badge&logo=github" alt="Stars" /></a>
  <a href="https://github.com/magnusoverli/sushe-online/issues"><img src="https://img.shields.io/github/issues/magnusoverli/sushe-online?style=for-the-badge&logo=github" alt="Issues" /></a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-development">Development</a> •
  <a href="#-browser-extension">Extension</a>
</p>

---

## 📖 About

SuShe Online is a web application for music enthusiasts who want to create, organize, and manage their album lists. Discover albums, track your collection, create playlists, and sync them to Spotify or Tidal.

**Built with:** Node.js 24 • Express 5 • PostgreSQL 18 • Tailwind CSS

---

## 📸 Screenshots

<p align="center">
  <img src="screenshots/desktop_screenshot.png" alt="Desktop View" width="100%" />
</p>

<p align="center">
  <em>Dark aesthetic with Spotify-inspired design — manage your album collection with rich metadata</em>
</p>

<details>
<summary><strong>📱 Mobile View</strong></summary>

<p align="center">
  <img src="screenshots/mobile_nosidebar_screenshot.png" alt="Mobile View" width="350" />
</p>

</details>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎵 Collection Management

- Create unlimited lists by year, genre, mood, or any theme
- Rich metadata from MusicBrainz and Deezer (cover art, release dates, artists)
- Drag & drop reordering
- Track selection for playlist creation
- Personal notes, ratings, and genre tags
- Duplicate detection

</td>
<td width="50%">

### 🎧 Streaming Integration

- Sync playlists to **Spotify** and **Tidal**
- Smart track matching across services
- Real-time progress tracking
- Choose your preferred platform per-playlist

</td>
</tr>
<tr>
<td width="50%">

### 🔌 Browser Extension

- Chrome extension for [RateYourMusic.com](https://rateyourmusic.com)
- Right-click any album → Add to your lists
- Automatic metadata lookup
- [Get the extension →](https://chromewebstore.google.com/detail/sushe-online-rateyourmusi/dnldndgncdhofafboeafamicpdkbdamk)

</td>
<td width="50%">

### 🔒 Security & Performance

- Production-grade: rate limiting, CSRF, CSP headers
- PostgreSQL with connection pooling
- Session management with Passport.js
- Gzip compression
- Docker-ready deployment

</td>
</tr>
</table>

---

## 🚀 Getting Started

### Prerequisites

- **Docker & Docker Compose** (recommended)
- OR Node.js 24+ and PostgreSQL 18+

### Deploy with Docker

```bash
# Clone the repository
git clone https://github.com/magnusoverli/sushe-online.git
cd sushe-online

# Create environment file
cp .env.example .env
# Edit .env with your settings

# Start the application
docker compose up --build -d

# View logs
docker compose logs -f app
```

Access at `http://localhost:3000`. Admin code appears in the console logs.

### Update Your Deployment

```bash
# Quick update (pulls latest image)
./update.sh

# Or manually
docker compose pull app
docker compose up -d app
```

---

## ⚙️ Configuration

### Essential Variables

```bash
# Required
SESSION_SECRET=your-secret-key-here
DATABASE_URL=postgresql://user:pass@localhost/sushe

# Optional
SENDGRID_API_KEY=your-key      # Password reset emails
BASE_URL=https://your-domain   # Email links
```

### Streaming Services (Optional)

<details>
<summary><strong>Spotify Configuration</strong></summary>

```bash
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=https://your-domain.com/auth/spotify/callback
```

</details>

<details>
<summary><strong>Tidal Configuration</strong></summary>

```bash
TIDAL_CLIENT_ID=your-client-id
TIDAL_REDIRECT_URI=https://your-domain.com/auth/tidal/callback
```

</details>

<details>
<summary><strong>Claude API Configuration (Album Summaries)</strong></summary>

```bash
# Required for album summary generation
ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional Claude API settings
CLAUDE_MODEL=claude-sonnet-5        # Model to use (default: claude-sonnet-5)
CLAUDE_SUMMARY_EFFORT=medium        # low|medium|high|xhigh|max (default: medium)
CLAUDE_MAX_TOKENS=4096              # Max tokens in response (default: 4096)
CLAUDE_REQUEST_TIMEOUT_MS=120000    # Per-request timeout (default: 120000)
CLAUDE_RATE_LIMIT_MS=500            # Min ms between requests (default: 500)

# Optional summary length configuration
CLAUDE_SUMMARY_SENTENCES=5          # Target sentences about the album (default: 5)
CLAUDE_SUMMARY_MIN_SENTENCES=2      # Minimum sentences before warning (default: 2)
CLAUDE_SUMMARY_MIN_CHARS=250        # Minimum characters before warning (default: 250)
CLAUDE_SUMMARY_MAX_CHARS=0          # Hard character cap, 0 = no cap (default: 0)

# Optional batch/backfill settings (services/album-summary.js)
ALBUM_SUMMARY_CONCURRENCY=3         # Parallel fetches during batch runs (default: 3)
ALBUM_SUMMARY_PAGE_SIZE=500         # Albums fetched per batch page (default: 500)

# Note: max_tokens
# - max_tokens is a HARD LIMIT (Claude stops generating at this point)
# - Thinking is on by default on Sonnet 5 and those tokens count against the
#   same budget as the visible text, so 4096 leaves room for both. It is a
#   ceiling, not a reservation — unused budget costs nothing.
# - Set too low, summaries truncate mid-sentence and are discarded.
```

`CLAUDE_SUMMARY_MIN_SENTENCES`, `MIN_CHARS` and `MAX_CHARS` only emit **log
warnings** — they never reject or regenerate a summary. `CLAUDE_SUMMARY_MAX_CHARS`
additionally becomes a hard cap stated in the prompt when set above `0`.

Get your API key from [Anthropic Console](https://console.anthropic.com/).

</details>

<details>
<summary><strong>How album summaries are written</strong></summary>

Summaries are generated by Claude with the server-side `web_search` tool, prompted in
[`utils/claude-summary.js`](utils/claude-summary.js). The only inputs sent to the model
are the **artist name and album title** read from the `albums` table — no tracklist,
cover, release metadata, or user data. Everything else in a summary comes from Claude's
own web search results.

The prompt asks for an encyclopedia-style entry covering release year, the artist and
their origin, the album's musical character, and its reception or significance, within a
word budget derived from `CLAUDE_SUMMARY_SENTENCES`.

**Artist associations.** Where the sources document extremist, hateful, or seriously
criminal associations for the artist or a member of the act, the prompt requires a
**dedicated final sentence** naming them: neo-Nazi, fascist, white-nationalist and
white-supremacist affiliations; racist, antisemitic, Islamophobic, homophobic,
transphobic and misogynistic statements; involvement in extremist political, religious,
occult or nationalist movements; terrorism or political violence; and convictions for
violent or sexual crimes.

That sentence must be about the artist and the fact rather than about reception, must
name the specific ideology, affiliation, statement, group or conviction with the year
where known, and must avoid softenings such as "controversial figure", "polarising
views" or "a troubled past" — those tell a reader who does not already know the history
nothing. The goal is that the user is plainly informed rather than left to decode a
hedge.

Where the sources document nothing of the kind, the model is instructed to write nothing
of the kind — no note that none was found, no assurance that the artist is
uncontroversial, no hedge. Most artists warrant no such sentence, so this costs no tokens
in the common case.

Responses are post-processed before storage: Markdown is reduced to plain text, common
preambles and meta-commentary are stripped, and a response that says "no information
available" or comes back too short is discarded and stored as _no summary_.

Changing the prompt does **not** regenerate existing summaries. Use the admin settings
drawer (Album Summaries → batch fetch) with the regenerate-all option to rewrite stored
summaries under new instructions; this re-runs an API call for every album.

</details>

### Security & Rate Limiting

Rate limiting is **enabled by default** with production-ready settings:

| Variable                  | Default | Description               |
| ------------------------- | ------- | ------------------------- |
| `RATE_LIMIT_LOGIN_MAX`    | `5`     | Login attempts per 15 min |
| `RATE_LIMIT_REGISTER_MAX` | `3`     | Registrations per hour    |
| `RATE_LIMIT_API_MAX`      | `100`   | API calls per 15 min      |
| `DISABLE_RATE_LIMITING`   | `false` | Disable for dev only      |
| `ENABLE_HSTS`             | `false` | Enable when behind HTTPS  |

<details>
<summary><strong>📋 Complete Environment Variables Reference</strong></summary>

### Core Settings

| Variable         | Default                 | Description                  |
| ---------------- | ----------------------- | ---------------------------- |
| `PORT`           | `3000`                  | Server port                  |
| `SESSION_SECRET` | **Required**            | Session encryption key       |
| `DATABASE_URL`   | **Required**            | PostgreSQL connection string |
| `DATA_DIR`       | `./data`                | Session file storage         |
| `BASE_URL`       | `http://localhost:3000` | Base URL for emails          |
| `LOG_SQL`        | `false`                 | Log all SQL queries          |

### Rate Limiting

| Variable                  | Default | Description                  |
| ------------------------- | ------- | ---------------------------- |
| `RATE_LIMIT_LOGIN_MAX`    | `5`     | Login attempts per 15 min    |
| `RATE_LIMIT_REGISTER_MAX` | `3`     | Registrations per hour       |
| `RATE_LIMIT_FORGOT_MAX`   | `3`     | Password reset requests/hour |
| `RATE_LIMIT_RESET_MAX`    | `5`     | Password resets per hour     |
| `RATE_LIMIT_SETTINGS_MAX` | `10`    | Settings changes per hour    |
| `RATE_LIMIT_API_MAX`      | `100`   | API calls per 15 min         |

### Database Tools

| Variable     | Default      | Description        |
| ------------ | ------------ | ------------------ |
| `PG_DUMP`    | `pg_dump`    | Path to pg_dump    |
| `PG_RESTORE` | `pg_restore` | Path to pg_restore |

### Claude API (Album Summaries)

| Variable                       | Default           | Description                                     |
| ------------------------------ | ----------------- | ----------------------------------------------- |
| `ANTHROPIC_API_KEY`            | **Required**      | Anthropic API key for Claude API                |
| `CLAUDE_MODEL`                 | `claude-sonnet-5` | Claude model to use                             |
| `CLAUDE_SUMMARY_EFFORT`        | `medium`          | Effort level: low/medium/high/xhigh/max         |
| `CLAUDE_MAX_TOKENS`            | `4096`            | Maximum tokens in API response (thinking incl.) |
| `CLAUDE_REQUEST_TIMEOUT_MS`    | `120000`          | Per-request timeout (milliseconds)              |
| `CLAUDE_RATE_LIMIT_MS`         | `500`             | Minimum delay between requests (milliseconds)   |
| `CLAUDE_SUMMARY_SENTENCES`     | `5`               | Target sentences about the album itself         |
| `CLAUDE_SUMMARY_MIN_SENTENCES` | `2`               | Minimum sentences before a log warning          |
| `CLAUDE_SUMMARY_MIN_CHARS`     | `250`             | Minimum characters before a log warning         |
| `CLAUDE_SUMMARY_MAX_CHARS`     | `0`               | Hard character cap in the prompt (`0` = no cap) |
| `ALBUM_SUMMARY_CONCURRENCY`    | `3`               | Parallel summary fetches during a batch run     |
| `ALBUM_SUMMARY_PAGE_SIZE`      | `500`             | Albums fetched per page during a batch run      |

</details>

---

## 🧑‍💻 Development

### Local Setup

```bash
# Install dependencies
npm install

# Start development server (auto-reload + CSS/JS watch)
npm run dev

# Build CSS and JS
npm run build
```

### Commands

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `npm run dev`           | Development server with hot reload |
| `npm run build`         | Build CSS and JS for production    |
| `npm test`              | Run test suite (~600 tests)        |
| `npm run test:e2e`      | End-to-end browser tests           |
| `npm run test:coverage` | Test coverage report               |
| `npm run lint`          | Check code quality                 |
| `npm run format`        | Format code with Prettier          |

### Project Structure

```
sushe-online/
├── routes/              # Express route handlers
│   ├── auth.js          # Authentication (login, register, password reset)
│   ├── api.js           # REST API endpoints
│   └── admin.js         # Admin dashboard
├── db/                  # Database layer
│   ├── postgres.js      # PostgreSQL client
│   └── migrations/      # Schema migrations
├── middleware/          # Express middleware
│   ├── auth.js          # Authentication middleware
│   ├── rate-limit.js    # Rate limiting
│   └── error-handler.js # Error handling
├── views/               # EJS templates
├── src/                 # Frontend source
│   ├── js/              # JavaScript (Vite bundled)
│   └── styles/          # Tailwind CSS
├── public/              # Static assets (built)
├── browser-extension/   # Chrome extension
└── test/                # Test suite (600+ tests)
```

### Testing

```bash
# Full test suite (includes linting)
npm test

# End-to-end browser tests
npm run test:e2e

# Coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

Tests cover security middleware, authentication, session management, input validation, and critical paths. See [TESTING.md](TESTING.md) for details.

---

## 🔐 Security

SuShe Online implements production-grade security:

| Feature              | Implementation                        |
| -------------------- | ------------------------------------- |
| **Rate Limiting**    | Prevents brute force attacks          |
| **CSRF Protection**  | Cross-site request forgery prevention |
| **XSS Prevention**   | Content Security Policy headers       |
| **SQL Injection**    | Parameterized queries                 |
| **Secure Sessions**  | HTTPOnly cookies with encryption      |
| **Password Hashing** | bcrypt with proper salting            |
| **Security Headers** | HSTS, CSP, X-Frame-Options            |
| **Input Validation** | Server-side validation on all inputs  |

### Whitelisted Services

CSP allows connections to: Spotify, Tidal, Deezer, MusicBrainz, Google Fonts, Wikimedia Commons, RestCountries API.

---

## 📦 Browser Extension

<p>
  <a href="https://chromewebstore.google.com/detail/sushe-online-rateyourmusi/dnldndgncdhofafboeafamicpdkbdamk"><img src="https://img.shields.io/badge/Chrome_Web_Store-Get_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store" /></a>
</p>

The **SuShe Online Chrome Extension** supercharges your music discovery by letting you add albums directly from [RateYourMusic.com](https://rateyourmusic.com) with a single right-click.

### Features

- 🖱️ Right-click context menu on any RateYourMusic album page
- 📋 Add directly to any of your SuShe lists
- 🔍 Automatic MusicBrainz metadata lookup
- 🖼️ Cover art and release date included automatically
- 🚫 Duplicate detection prevents adding the same album twice

### Installation

| Method               | Link                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Chrome Web Store** | [Install from Chrome Web Store](https://chromewebstore.google.com/detail/sushe-online-rateyourmusi/dnldndgncdhofafboeafamicpdkbdamk) |
| **Manual Install**   | [browser-extension/README.md](browser-extension/README.md)                                                                           |

> 💡 **Tip:** After installing, configure your SuShe Online instance URL in the extension options, then browse RateYourMusic and right-click any album to add it!

---

## 🐳 Docker Deployment

### Production Checklist

1. **Use a reverse proxy** (nginx, Caddy, Traefik) for SSL
2. **Set `ENABLE_HSTS=true`** when behind HTTPS
3. **Configure `BASE_URL`** to your domain
4. **Set strong `SESSION_SECRET`**
5. **Configure email** for password resets
6. **Regular backups** via admin dashboard or pg_dump

### Automatic Updates

Use [Watchtower](https://containrrr.github.io/watchtower/) for automatic updates:

```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower sushe-online \
  --cleanup --interval 3600
```

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with a descriptive message
6. Push and open a Pull Request

### Code Style

- Format with Prettier (`npm run format`)
- Follow ESLint rules (`npm run lint`)
- Write tests for new features
- Keep the dark aesthetic 🤘

---

## 🛠 Tech Stack

<p>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white" />
</p>

**Data Sources:** MusicBrainz • Deezer • Spotify API • Tidal API

---

## 📄 License

This project is open source. Feel free to use, modify, and distribute.

---

<p align="center">
  Made with ❤️ for music lovers who want to catalog their musical journey
  <br />
  <strong>🤘 Happy cataloging!</strong>
</p>
