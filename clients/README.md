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

## Windows app

`desktop/` is the same app on Compose Desktop (it also builds on macOS and Linux). Folders are
plain paths: the setup card opens the chooser at the profile's `defaultPaths.windows` and offers
any of those folders that exist. The library, game pages and sync engine come from `shared/`.

- It lives in the tray (status, Sync now, Open, Quit); closing the window keeps it running, and
  starting it again brings the window back. `--hidden` starts it in the tray.
- It syncs at start, every 15 minutes, and 8 seconds after a watched save folder changes
  (`WatchService`, limited to the folders a profile can keep saves in).
- Settings, the hash cache and cached covers live in `%LOCALAPPDATA%\RomSafe`. The device token is
  sealed with DPAPI, so only the same Windows user can read it.

## Building

`clients/` is one Gradle build (Kotlin DSL, version catalog in `gradle/libs.versions.toml`). It
needs JDK 21 and the Android SDK (`ANDROID_HOME`, or `sdk.dir` in `clients/local.properties`).

```sh
cd clients
./gradlew :shared:allTests            # API client tests (JVM and Android host)
./gradlew :android:assembleDebug      # android/build/outputs/apk/debug/android-debug.apk
adb install -r android/build/outputs/apk/debug/android-debug.apk
./gradlew :desktop:run                # the Windows app; :desktop:packageMsi builds an installer
```

The server usually runs plain HTTP on the LAN. The app allows cleartext only to hosts that resolve
to private, loopback or Tailscale (100.64.0.0/10) addresses; anything else needs `https://`.
`docs/sync-protocol.md` is the API contract.
