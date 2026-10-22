# 🔥 Bonfire

**Your game library and saves, kept warm on every device.**

Bonfire is a self-hosted ROM library and save-sync server. Think RomM's
library and metadata, plus Syncthing-style sync that understands emulators:

- **Library.** Scans your ROM folders, hashes every file, groups files into games, and scrapes
  metadata and box art (IGDB, SteamGridDB, and libretro thumbnails, which need no key).
- **Save backups.** Every save version is kept. The current version of each save is also written
  as a plain file into the save folder you choose, e.g. `~/saves/3ds/...`.
- **Per-device mapping.** On each phone, handheld or PC you pick, per platform, which emulator you
  use and the folder where it keeps saves. Bonfire translates between layouts. A save made in
  RetroArch on Android (`Game.srm`) lands in mGBA on Windows as `Game.sav`, and 3DS saves keep
  Azahar's `Nintendo 3DS/<id0>/<id1>/title/...` structure.
- **ROM tracking.** Devices report which ROMs they have. Bonfire matches them to server ROMs (by
  hash, file name or title) and lets you send missing ROMs to a device.
- **Safe conflicts.** If a save changed on both sides, Bonfire keeps both copies and asks you which
  one wins. Nothing is silently overwritten.

```
             ┌────────────────────────────────────────┐
             │  Bonfire server (Docker / LXC)         │
             │  web GUI · library scanner · scraper   │
             │  save store + history · sync API       │
             └────────▲───────────────────▲───────────┘
                      │ HTTPS + device token
          ┌───────────┴─────┐       ┌─────┴───────────┐
          │  Android app    │       │  Windows app    │
          │  folder picker  │       │  tray sync      │
          │  per platform   │       │  per platform   │
          └─────────────────┘       └─────────────────┘
```

## Status

| Piece | State |
| --- | --- |
| Server: library scan, hashing, 3DS title IDs | ✅ |
| Server: metadata and cover scraping | ✅ IGDB, SteamGridDB, libretro thumbnails |
| Server: save sync, version history, conflicts | ✅ with an end-to-end test suite |
| Server: ROM inventory matching and download queue | ✅ |
| Web GUI | ✅ library, game pages, platforms, devices, conflicts, settings |
| Docker image | ✅ |
| Android app | 🛠 planned: see [clients/README.md](clients/README.md) |
| Windows app | 🛠 planned, sharing the Android sync engine |

## Quick start (Docker)

```sh
git clone <this repo> bonfire && cd bonfire
# edit docker-compose.yml: the volume paths and the user/uid
docker compose up -d --build
```

Open `http://<server>:8080` and create an admin password. Then:

1. **Platforms**: for each system, set the ROM folder and the save folder as the container sees
   them, e.g. ROMs `/library/roms/3ds` and saves `/library/saves/3ds`.
2. **Library → Scan library**: indexes ROMs and imports any saves already in your save folders.
3. **Library → Scrape metadata**: fills in covers and descriptions. Add IGDB/SteamGridDB keys
   under **Settings** for more than libretro box art.
4. **Devices → Pair a device**: shows a code to enter in the app.

### LXC (Proxmox etc.)

Either run Docker inside the container, or run Bonfire directly on Node.js 24:

```sh
apt install -y git curl && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs
git clone <this repo> /opt/bonfire && cd /opt/bonfire && npm ci && npm run build
BONFIRE_DATA_DIR=/var/lib/bonfire node server/dist/index.js
```

(Wrap the last line in a systemd unit to start it on boot.)

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BONFIRE_PORT` | `8080` | HTTP port |
| `BONFIRE_DATA_DIR` | `./data` (`/data` in Docker) | Database, save history blobs, covers |
| `BONFIRE_ADMIN_PASSWORD` | unset | Fixed admin password (otherwise set on first run) |
| `BONFIRE_PROFILES_DIR` | `./profiles` | Emulator profile YAML files |

Put Bonfire behind a reverse proxy with HTTPS (Caddy, Traefik, Nginx Proxy Manager) if devices
reach it over the internet. Device tokens are bearer tokens.

## How saves are identified

Each save is stored under a **game key** plus a **file name**:

| Platform type | Game key | Example |
| --- | --- | --- |
| Cartridge systems (GB/GBA/NES/SNES/N64/DS/Genesis…) | ROM file name without extension | `Metroid Fusion (USA)` + `battery.sav` |
| 3DS | Title ID | `00040000000a5e00` + `00000001/main` |
| PSP | `SAVEDATA` folder name | `ULUS10336DATA00` + `DATA.BIN` |

**Emulator profiles** (`profiles/*.yaml`) map those keys to each emulator's file layout, and each
platform's **save layout** decides where the server writes its copy. When a device names a ROM
differently from the server, Bonfire uses the ROM match to translate the save name. See
[docs/emulator-profiles.md](docs/emulator-profiles.md).

## Development

```sh
npm install
npm run dev          # API on :8080 (tsx watch)
npm run dev:web      # web GUI on :5173, proxied to the API
npm test             # server unit + end-to-end sync tests
npm run typecheck
```

- `server/`: Fastify + TypeScript, SQLite via the built-in `node:sqlite`.
- `web/`: React + Vite + Tailwind.
- `profiles/`: emulator profiles.
- `docs/`: [architecture](docs/architecture.md), [sync protocol](docs/sync-protocol.md), [emulator profiles](docs/emulator-profiles.md).
- `clients/`: plan for the Android and Windows apps.
