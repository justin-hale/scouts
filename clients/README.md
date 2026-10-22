# RomSafe clients

Both apps will share one Kotlin Multiplatform **sync engine**, so the planning, hashing, conflict
and retry logic is written once.

```
clients/
  shared/        Kotlin Multiplatform: API client (Ktor), sync engine, local cache
  android/       Jetpack Compose app: SAF folder pickers, WorkManager background sync
  desktop/       Compose Desktop app for Windows: tray icon, folder pickers, file watching
```

## Shared engine

- A `FileTree` interface with two implementations: Android `DocumentFile` (SAF tree URIs) and
  `java.nio` on desktop. It covers listing, reading, atomic writes and modified times.
- `SyncEngine.syncPlatform(platform)`: inventory ROMs, plan saves, then carry out the actions
  (see `docs/sync-protocol.md`).
- A local SQLite cache (SQLDelight) keyed by path, size and mtime → sha256, so unchanged files
  aren't re-hashed every run.

## Android app (first)

1. **Pair**: enter the server URL and a pairing code (later, scan a QR code from the web GUI).
2. **Platforms**: for each platform the server enables:
   - pick an emulator profile (e.g. 3DS → Azahar);
   - pick the save folder (for Azahar, the folder that contains `Nintendo 3DS`) with the system
     folder picker, keeping the permission with `takePersistableUriPermission`;
   - optionally pick the ROM folder.
3. **Sync**: a periodic WorkManager job (15 min minimum, Wi-Fi/charging constraints configurable),
   plus "Sync now", a Quick Settings tile, and a sync when the app opens.
4. **Library**: browse the server's games with covers and download ROMs into the mapped ROM folder.
5. **Conflicts**: a notification, then a choice of which copy to keep.

Known constraint: on Android 11+ the app cannot read `Android/data/<other app>`. Most emulators
can move their data to a user folder (Azahar, Dolphin, RetroArch, PPSSPP, DuckStation,
NetherSX2). Shizuku support can cover the rest later.

## Windows app (second)

The same screens on Compose Desktop. It lives in the tray and uses `WatchService` to sync shortly
after a save changes, instead of polling.

## Building

These need the Android SDK and Gradle and aren't scaffolded yet. The server's
`docs/sync-protocol.md` is the contract they will be built against.
