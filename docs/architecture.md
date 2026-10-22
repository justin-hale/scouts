# Architecture

## Components

| Component | Tech | Role |
| --- | --- | --- |
| Server | Node 24, Fastify, `node:sqlite` | Source of truth: library, save store, sync decisions |
| Web GUI | React, Vite, Tailwind | Admin UI, served by the server |
| Android app | Kotlin, Compose (planned) | Picks folders through the Storage Access Framework, runs background sync |
| Windows app | Kotlin/Compose Desktop (planned) | Same sync engine, as a tray app |

The design is **hub and spoke**, not peer to peer. Devices only talk to the server, and the server
decides what each device should upload or download. This keeps clients thin and gives one place for
history, conflict handling and layout translation.

## Data model (SQLite)

- `platforms`: server paths per platform (ROM folder, save folder, optional save-layout override).
  The platform catalog itself (extensions, how saves are keyed, IGDB IDs) is code: `server/src/platforms.ts`.
- `games` and `roms`: the library. ROMs are hashed (CRC32/MD5/SHA-1). 3DS cartridge images also get
  their title ID read from the NCSD/NCCH header.
- `saves`: one row per `(platform, game_key, file)`, pointing at its current version.
- `save_versions`: every version ever seen. Contents live in `data/blobs/<sha256>` (deduplicated).
- `devices`, `device_mappings`: paired devices, and per platform the emulator profile plus the
  device's own folder paths (shown in the GUI; the device resolves them).
- `device_roms`: ROM files each device reported, and the server ROM each one matched.
- `device_rom_queue`: ROMs waiting to be downloaded to a device.
- `device_save_state`: for each device and save, the version they last agreed on. This drives
  sync decisions.
- `conflicts`: open and resolved conflicts.

## Save storage

1. A device uploads bytes. They are stored once, content-addressed, as a new `save_versions` row.
2. If that version becomes current, it is also **mirrored** to
   `<platform save folder>/<save layout>`, written atomically. The folder you mapped on the server
   therefore always holds ordinary save files you can back up or copy by hand.
3. A library scan also **imports** files from the save folder: any file whose content differs from
   the current version becomes a new version. This is how existing backups get picked up, and you
   can drop a save in by hand.

Restoring an old version in the GUI just moves the current pointer. Devices then download it on
their next sync, because their state no longer matches.

## Sync decision table

For each save the device reports (`L` = device file hash, `A` = the version the device last agreed
on, `S` = the server's current version):

| Condition | Action |
| --- | --- |
| no server copy | upload |
| `L == S` | ok (record agreement) |
| open conflict for this device and save | wait for the user |
| `L == A.hash`, `A != S` | download (only the server changed) |
| `A == S`, `L != S` | upload (only the device changed) |
| anything else | conflict: device uploads its copy as a side version, user picks |

The server also offers downloads for saves the device doesn't have, when the device's profile can
place them and (for ROM-keyed platforms) the device has that game's ROM.

## Things the clients have to handle

- **Android scoped storage.** Folders are chosen with `ACTION_OPEN_DOCUMENT_TREE`, and the
  permission is persisted. `Android/data/<pkg>` is off-limits on Android 11+, so emulators that
  keep saves there need their storage moved to a user folder, or (optionally) Shizuku.
- **No file watching on SAF trees.** Sync runs on a WorkManager schedule (15 min minimum), when the
  app opens, and from a "Sync now" button or tile.
- **Emulators holding saves in memory.** Skip files modified in the last few seconds, and
  optionally sync when the emulator goes to the background (usage-stats permission).
- **Format differences.** Most battery saves are byte-identical across emulators. Converters (for
  example DeSmuME `.dsv` footers) are a future profile feature.
