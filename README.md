<p align="center">
  <img src="docs/banner.png" alt="Torboxed — the beautiful self-hosted downloader for TorBox" width="100%">
</p>

<p align="center">
  <a href="https://github.com/scopeddlol/torboxed/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/scopeddlol/torboxed/ci.yml?branch=main&label=CI&style=flat-square"></a>
  <a href="https://github.com/scopeddlol/torboxed/pkgs/container/torboxed"><img alt="Docker" src="https://img.shields.io/badge/ghcr.io-torboxed-8b5cf6?style=flat-square&logo=docker&logoColor=white"></a>
  <a href="https://github.com/scopeddlol/torboxed/releases/latest"><img alt="Windows" src="https://img.shields.io/github/v/release/scopeddlol/torboxed?label=Windows&style=flat-square&color=06b6d4&logo=windows"></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square">
</p>

**Torboxed** links to your [TorBox](https://torbox.app) account and turns it into a hands-off download machine. You drop in magnet links or `.torrent` files, one at a time or hundreds at once. Torboxed sends them to TorBox, waits for the cloud to finish (instantly, if they're cached), and then downloads the files straight to the right folder on your disk. Sonarr, Radarr and the rest of the *arr family can use it as if it were qBittorrent.

It runs as a **Docker container** on your server or as a **Windows desktop app** that lives in your system tray.

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="Torboxed desktop app" width="100%">
</p>

## ✨ Features

|  |  |
|---|---|
| ⚡ **TorBox, fully automated** | Add magnets, `.torrent` files or URLs, one at a time or in bulk. They're sent to TorBox, polled until ready and downloaded automatically. |
| 📺 **Sonarr & Radarr** | Built-in **qBittorrent Web API** emulation. Add Torboxed as a qBittorrent client in any *arr app: categories, imports and removal all work. |
| 🏷️ **Tags → folders** | Tags route downloads to specific folders and sub-folders. *arr categories become tags automatically. |
| 🗂️ **Multiple download folders** | Add as many drives or shares as you like and see free space at a glance. |
| 🐢 **Slow mode & pause** | One-click slow mode (with its own limit) and pause-all, from the top bar, the tray icon or any right-click. |
| 📈 **Live speed** | Real-time speed, sparklines, per-torrent ETA, and TorBox cloud progress. |
| 📊 **Analytics** | Daily volume, 24-hour speed, activity heatmap, tag breakdown, cache-hit rate, size distribution, storage and history. |
| 🧹 **Auto-remove** | Optionally delete from TorBox and/or clear the list once a download finishes. Removal lets you choose TorBox, list, files or all three. |
| ☁️ **TorBox Cloud browser** | See everything in your TorBox account and pull any of it down with one click. |
| 🎨 **12 themes** | Aurora, Midnight, OLED, Nord, Dracula, Catppuccin, Tokyo Night, Rosé Pine, Sunset, Daylight, Latte and Solarized, plus custom accent colours and a compact mode. |
| 🖱️ **Context-aware right-click** | A custom context menu everywhere: torrents, tags, folders, text fields, links and empty space. |
| ⚙️ **Settings live in the app** | No `.env`, no YAML, no config files. Everything is configured in the UI, with backup/restore. |
| 🔓 **No login** | No built-in authentication by design. Put it behind your reverse proxy / SSO. |
| 🪟 **Windows app** | Custom title bar, system tray with quick actions, notifications, launch on startup, and `.torrent`/magnet file associations. |

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/downloads.png" alt="Downloads"><p align="center"><b>Downloads</b>: live progress through TorBox and your disk</p></td>
    <td width="50%"><img src="docs/screenshots/analytics.png" alt="Analytics"><p align="center"><b>Analytics</b>: metrics, trends and history</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/context-menu.png" alt="Context menu"><p align="center"><b>Right-click anywhere</b>: context-aware menus</p></td>
    <td><img src="docs/screenshots/add-torrents.png" alt="Add torrents"><p align="center"><b>Bulk add</b>: magnets, URLs and many .torrent files at once</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/details.png" alt="Details"><p align="center"><b>Details</b>: files, timings and paths</p></td>
    <td><img src="docs/screenshots/cloud.png" alt="TorBox Cloud"><p align="center"><b>TorBox Cloud</b>: your whole TorBox library</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/tags-folders.png" alt="Tags and folders"><p align="center"><b>Tags & Folders</b>: route downloads automatically</p></td>
    <td><img src="docs/screenshots/settings-integrations.png" alt="Integrations"><p align="center"><b>Sonarr & Radarr</b>: step-by-step setup built in</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings-appearance.png" alt="Appearance"><p align="center"><b>Appearance</b>: 12 themes + accent colours</p></td>
    <td><img src="docs/screenshots/settings-automation.png" alt="Automation"><p align="center"><b>Automation</b>: auto-remove & cleanup</p></td>
  </tr>
</table>

<details>
<summary><b>🎨 More themes</b></summary>
<br>
<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/theme-daylight.png" alt="Daylight"><p align="center">Daylight</p></td>
    <td width="33%"><img src="docs/screenshots/theme-nord.png" alt="Nord"><p align="center">Nord</p></td>
    <td width="33%"><img src="docs/screenshots/theme-dracula.png" alt="Dracula"><p align="center">Dracula</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/theme-sunset.png" alt="Sunset"><p align="center">Sunset</p></td>
    <td><img src="docs/screenshots/theme-oled.png" alt="OLED"><p align="center">OLED</p></td>
    <td><img src="docs/screenshots/theme-latte.png" alt="Catppuccin Latte"><p align="center">Catppuccin Latte</p></td>
  </tr>
</table>
</details>

## 🚀 Getting started

### 🐳 Docker Compose (self-hosted)

```yaml
services:
  torboxed:
    image: ghcr.io/scopeddlol/torboxed:latest
    container_name: torboxed
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PUID=1000   # owner of downloaded files
      - PGID=1000
      - TZ=Etc/UTC
    volumes:
      - ./config:/config
      - /path/to/downloads:/downloads
```

```bash
docker compose up -d
```

Open `http://<your-server>:8080`, paste your TorBox API key into the welcome card, and you're done. The full [`docker-compose.yml`](docker-compose.yml) also includes a commented Sonarr + Radarr example.

<details>
<summary>Plain <code>docker run</code></summary>

```bash
docker run -d --name torboxed --restart unless-stopped \
  -p 8080:8080 -e PUID=1000 -e PGID=1000 \
  -v ./config:/config -v /path/to/downloads:/downloads \
  ghcr.io/scopeddlol/torboxed:latest
```
</details>

Images are published for `linux/amd64` and `linux/arm64`, tagged `latest`, `1`, `1.2`, `1.2.3` and `sha-<commit>`.

### 🪟 Windows

Download from the [latest release](https://github.com/scopeddlol/torboxed/releases/latest):

- **`Torboxed-Setup-x.y.z.exe`**: installer with Start-menu and desktop shortcuts, `.torrent`/magnet associations and an uninstaller.
- **`Torboxed-Portable-x.y.z.exe`**: a single exe, no installation needed.

The desktop app runs the full server inside it. Its UI and qBittorrent API listen on `http://127.0.0.1:8765` by default. Turn on **Settings → Desktop app → Allow network access** if Sonarr/Radarr run on another machine.

> The builds are not code-signed yet, so Windows SmartScreen may warn on first launch. Click **More info → Run anyway**.

**Tray menu:** open, add a magnet from the clipboard, add .torrent files, pause all, slow mode, jump to any page, open the downloads folder, launch on startup, quit. The tray icon changes to show whether Torboxed is idle, downloading, paused or in slow mode.

## 📺 Sonarr / Radarr / Lidarr / Readarr / Prowlarr

Torboxed implements the qBittorrent Web API v2 at `/api/v2` on the same port as the UI.

1. In the *arr app, go to **Settings → Download Clients → + → qBittorrent**.
2. **Host:** your Torboxed host (e.g. `torboxed` in the same compose stack). **Port:** `8080` (desktop: `8765`). Any username/password works.
3. **Category:** e.g. `tv-sonarr` / `radarr`. Torboxed creates a matching **tag** that downloads into `<default folder>/<category>`. Point the tag at another folder or sub-folder in **Tags & Folders** if you like.
4. **Test**, then **Save**. Enable **Remove Completed** so the *arr removes finished items after importing them.

Torboxed reports finished downloads as *completed/paused* with a ratio limit already reached. That lets the *arr apps import them and then remove them, which also clears them from TorBox if you want it to.

**Paths:** Sonarr/Radarr must be able to see the files at the path Torboxed reports. With Docker, mount the same host folder at the same container path (e.g. `/downloads`) in every container. Otherwise, add a **Remote Path Mapping** in the *arr app.

## ⚙️ Configuration

Everything is configured **inside the app**: API key, folders, tags, concurrency, retries, speed limits, slow mode, auto-remove rules, sub-folder behaviour, skipped file types, TorBox seeding, themes, notifications and desktop behaviour. State is kept in one managed database file (`/config/torboxed.json` in Docker, `%APPDATA%\Torboxed` on Windows). You never need to edit it. Use **Settings → Backup & data** to export or import it.

The only knobs outside the app are Docker-level environment variables, and all of them are optional:

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | `1000` | User/group that owns files Torboxed writes. `PUID=0` runs as root. |
| `UMASK` | `002` | File-creation mask. |
| `TZ` | `UTC` | Timezone for logs and analytics. |

### 🔐 Authentication

Torboxed has **no built-in login**, by design. Put it behind your reverse proxy (Authelia, Authentik, Cloudflare Access, basic auth, …). If your *arr apps connect through the proxy, exempt `/api/v2/*` from SSO or have them connect to the container directly. The UI works under a sub-path (e.g. `https://example.com/torboxed/`), because every asset and API call is relative.

## ⌨️ Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>N</kbd> | Add torrents |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> | Paste magnets or `.torrent` files anywhere |
| <kbd>/</kbd> | Search |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> · <kbd>Del</kbd> · <kbd>Enter</kbd> | Select all · remove selected · open details |
| <kbd>Alt</kbd> + <kbd>1</kbd>–<kbd>5</kbd> | Switch pages |
| <kbd>Ctrl</kbd> + <kbd>,</kbd> | Settings |
| <kbd>F11</kbd> | Full screen (desktop) |

You can also drag `.torrent` files onto the window from anywhere.

## 🛠️ Development

Requirements: **Node.js 22+**.

```bash
npm install
npm run dev          # API on :8080 + Vite UI with hot reload on :5173
npm run demo         # UI with realistic sample data and a fake TorBox, on :8090
npm run desktop      # build and launch the Electron app
npm test             # unit + end-to-end tests (against a fake TorBox API)
npm run typecheck
npm run build        # dist/web (UI), dist/server/index.cjs, dist/desktop/*
npm run dist:win     # package the Windows installer + portable exe
npm run icons        # regenerate all icons from branding/*.svg
npm run screenshots  # regenerate docs/screenshots from the demo
```

```
src/
├── server/    Express server: TorBox client, download engine, qBittorrent API, analytics
├── web/       React UI (Vite): pages, components, themes, context menu
├── desktop/   Electron main process, preload bridge, tray icons
└── shared/    Types and theme palettes shared by all three
branding/      Logo & tray-icon sources (SVG)
test/          Vitest suites + a fake TorBox API/CDN
```

**How it works:** each torrent moves through `queued → TorBox → ready → downloading → completed`. Torboxed submits to TorBox (spacing requests and backing off on rate limits) and polls `mylist` until the files are present. It then asks for a download link per file and streams the file to `<folder>/<name>.part`. Downloads resume with HTTP range requests and share a global token-bucket speed limiter. Each file is renamed into place when it finishes.

## 📦 Releasing

CI builds everything on every push. To publish a release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

- **`docker.yml`** builds a multi-arch image and pushes it to `ghcr.io/scopeddlol/torboxed` (`latest` on `main`, plus semver tags on releases).
- **`release.yml`** builds the Windows installer and portable exe and attaches them to a GitHub Release.

## 🙏 Credits

Built on [TorBox](https://torbox.app)'s public API. Torboxed is an independent project and isn't affiliated with TorBox. Icons by [Lucide](https://lucide.dev). Fonts: Inter & JetBrains Mono.

## 📄 License

[MIT](LICENSE)
