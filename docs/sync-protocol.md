# Device sync protocol (v1)

JSON over HTTPS. Every endpoint except `/pair` needs `Authorization: Bearer <device token>`.
All save and ROM paths are **relative to the folder the user picked for that platform**, use `/`
separators, and may not contain `..`.

## Pairing

```http
POST /api/device/pair
{ "code": "K7Q2M9XA", "name": "Retroid Pocket 5", "kind": "android" }
→ { "deviceId": 3, "token": "…" }
```

The code comes from **Devices → Pair a device** in the web GUI and is valid for 10 minutes. Store
the token securely (Android Keystore / Windows DPAPI).

## Configuration

```http
GET /api/device/config
→ { device, platforms: [{ slug, name, keyKind, romExtensions, profiles: ["retroarch", …] }],
    profiles: [ …full profile definitions… ], mappings: [ … ] }
```

The client shows the enabled platforms. For each one the user picks a profile (from that
platform's `profiles`), a save folder and optionally a ROM folder. It then reports the mappings:

```http
PUT /api/device/mappings
{ "mappings": [ { "platform": "3ds", "profile": "azahar", "saveRoot": "content://…", "romRoot": "content://…" } ] }
```

`saveRoot` and `romRoot` are informational (shown in the GUI). The device keeps its own folder
handles.

A device can use more than one emulator for a platform (Azahar and Citra MMJ for 3DS, say), each
with its own save folder. Send one mapping per emulator with a different `slot`, a short string
the client picks; leave it out (or `""`) for the first. Each slot syncs as its own copy, with its
own last-agreed versions, so pass the same `slot` to plan, upload and ack:

```http
{ "mappings": [ { "platform": "3ds", "profile": "azahar", "saveRoot": "…azahar-emu/sdmc" },
                { "platform": "3ds", "slot": "2", "profile": "azahar", "saveRoot": "…citra-emu/sdmc" } ] }
```

## ROMs

Report what is in each ROM folder (send `complete: true` to replace the previous list). `sha1` is
optional but gives exact matches; hashing large ISOs on a phone is slow, so clients may hash only
files under a size limit.

```http
POST /api/device/roms/inventory
{ "platform": "gba", "complete": true,
  "files": [ { "path": "Metroid Fusion.gba", "size": 8388608, "sha1": "…" } ] }
→ { "results": [ { "path": "Metroid Fusion.gba", "romId": 12, "match": "hash" } ] }
```

Match kinds: `hash`, `name` (same file name), `title` (same cleaned title, unique), `manual`
(linked in the GUI), `none`.

Browse the server library or fetch the download queue:

```http
GET  /api/device/roms?platform=gba        → [ { id, relPath, fileName, size, sha1, gameTitle, localPath|null } ]
POST /api/device/roms/queue  { "romIds": [12, 13] }
GET  /api/device/roms/queue               → [ { id, platform, relPath, fileName, size, sha1, url } ]
GET  /api/roms/{id}/download              (supports Range for resumable downloads)
DELETE /api/device/roms/queue/{id}
```

After a download, write the file to `romRoot/relPath` and send an inventory update. That also
removes it from the queue.

ROMs that need companion files (a `.cue` and its `.bin` tracks, an `.m3u` and its discs, a CloneCD
`.img` with its `.ccd`/`.sub`) download as one `application/zip` named `<stem>.zip`, without Range
support. Its entries are stored (uncompressed), with paths relative to the ROM's folder: extract
them into the folder of `romRoot/relPath`.

## Saves

Saves sync **before** ROM inventory changes take effect, so send the ROM inventory first. That
lets the server translate save names between differently named ROMs.

### 1. Plan

List every file under the save folder (profiles may nest saves several folders deep) and send
hashes:

```http
POST /api/device/saves/plan
{ "platform": "gba", "slot": "", "files": [ { "path": "Metroid Fusion.srm", "sha256": "…", "size": 8192 } ] }
→ { "actions": [ … ] }
```

| `action` | Client does |
| --- | --- |
| `ok` | nothing |
| `upload` | `PUT /saves/upload` with `base = baseVersionId` |
| `download` | fetch `versionId`, verify `sha256`, write to `path`, then `POST /saves/ack` |
| `conflict` | `PUT /saves/upload` with `base = baseVersionId` and `conflict=1`, then tell the user |
| `pending-conflict` | leave the file alone until the user resolves it in the GUI |
| `unrecognized` | not a save file for this profile; ignore |

Download actions can also name files the device doesn't have yet. Create parent folders as needed.

### 2. Upload

```http
PUT /api/device/saves/upload?platform=gba&path=Metroid%20Fusion.srm&base=41[&conflict=1][&slot=2]
Content-Type: application/octet-stream
<bytes>
→ { "status": "ok" | "conflict", "saveId": 7, "versionId": 42, "conflictId"?: 3 }
```

If the server moved on since `base`, the upload is stored as a side version and a conflict is
opened (`status: "conflict"`). Uploads are never lost.

### 3. Download and acknowledge

```http
GET  /api/save-versions/{versionId}/download   (X-Save-Sha256 header)
POST /api/device/saves/ack { "saveId": 7, "versionId": 42, "slot": "" }
```

Write to a temp file in the same folder and rename it over the target, so the emulator never
reads half a save. Only acknowledge after the write succeeds.

## Client rules of thumb

- Skip files modified in the last ~5 seconds; the emulator may still be writing.
- Run one platform at a time. Keep going after per-file errors and report them.
- A local deletion is **not** propagated: the next plan offers the save back as a download.
  Deleting saves is done in the GUI.
