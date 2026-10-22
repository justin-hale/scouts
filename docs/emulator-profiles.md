# Emulator profiles

A profile describes where one emulator keeps save files **inside the folder the user picks** on a
device. Profiles live in `profiles/*.yaml` and load when the server starts. Add a file and
restart to support another emulator.

```yaml
id: azahar                       # lowercase, unique
name: Azahar / Citra / Lime3DS
description: Pick the "sdmc" folder, the one that contains "Nintendo 3DS".
defaultPaths:                    # hints shown by the apps
  android: ["azahar-emu/sdmc"]
  windows: ["%APPDATA%\\Azahar\\sdmc"]
saves:
  - platforms: ["3ds"]
    pattern: "Nintendo 3DS/{id0}/{id1}/title/{category:8}/{titleLow:8}/data/{file**}"
    defaults:                    # used when placing a save on a new device
      id0: "00000000000000000000000000000000"
      id1: "00000000000000000000000000000000"
```

## Patterns

| Token | Matches |
| --- | --- |
| `{name}` | one path segment |
| `{name:8}` | exactly 8 characters (lets two variables share a segment) |
| `{name**}` | one or more segments, slashes included |

Literal text is matched case-insensitively.

A rule must contain the platform's **game key** variables:

| Platform | Key variables |
| --- | --- |
| ROM-keyed (`gb`, `gba`, `nes`, `snes`, `n64`, `nds`, `genesis`, …) | `{game}`: ROM file name without extension |
| `3ds` | `{category}` and `{titleLow}`, the two halves of the title ID |
| `psp` | `{saveDir}` |

It must also contain either `{file}`/`{file**}` (the file's name inside the game), or a fixed
`file:` that names the canonical file. Cartridge battery saves use `file: battery.sav` and
real-time-clock data uses `file: rtc`, so RetroArch's `Game.srm` and mGBA's `Game.sav` are the
same save.

`platforms: ["*"]` applies a rule to every ROM-keyed platform.

When the server places a save on a device, it renders the **first** rule whose `file` matches.
When reading a device's files, it uses the first rule that matches the path.

## Server save layout

Each platform's save folder on the server uses the same template syntax (set on the
**Platforms** page). The defaults are:

| Platform | Default layout |
| --- | --- |
| ROM-keyed | `{game}/{file**}` → `Metroid Fusion (USA)/battery.sav` |
| 3DS | `Nintendo 3DS/000…/000…/title/{category}/{titleLow}/data/{file**}` |
| PSP | `SAVEDATA/{saveDir}/{file**}` |

The 3DS default matches Citra's layout, so you can copy `~/saves/3ds` straight into an emulator's
`sdmc` folder.

## Included profiles

| Profile | Platforms | Saves |
| --- | --- | --- |
| `retroarch` | all ROM-keyed | `{game}.srm`, `{game}.rtc` |
| `generic-sav` | all ROM-keyed | `{game}.sav` |
| `mgba` | gb, gbc, gba | `{game}.sav` |
| `melonds` | nds | `{game}.sav` |
| `azahar` | 3ds | Citra-style `Nintendo 3DS/...` |
| `ppsspp` | psp | `PSP/SAVEDATA/{saveDir}/...` |

## Known gaps / ideas

- DraStic and DeSmuME (`.dsv`) add a footer to DS saves, so they need a converter step.
- Memory-card systems (PS1/PS2/GameCube) share one card file across many games. These will be
  synced as whole cards (game key = card name) rather than per game.
- Dolphin GCI folders, DuckStation per-game cards and Switch saves are all good next profiles.
