# goldberg-ach-fix

**Make Steam-emulator achievements actually work** — generate a correct
`steam_settings/achievements.json` (real Steam API names, icons and descriptions),
un-break [Achievement Watcher], and get live desktop notifications when you unlock.

> 🇵🇱 **Po polsku, w skrócie:** jeżeli grasz w grę na emulatorze Steam (Goldberg /
> gbe_fork — folder `GSE Saves`) i osiągnięcia **nie wyskakują w grze** ani **nie
> pokazują się w Achievement Watcher** — ten program to naprawia. Pobiera prawdziwą
> listę osiągnięć ze Steama (z nazwami i ikonami), wgrywa ją do gry, i odblokowuje
> grę w Achievement Watcher. Uruchom: `achfix fix --game "<ścieżka do gry>" --key <klucz>`.

---

## The problem this solves

Cracked / DRM-free builds ship with a Steam-API emulator (Goldberg or its active
fork **gbe_fork**). The emulator needs a file, `steam_settings/achievements.json`,
that tells it **which achievements the game has**. When that file is missing,
incomplete, or uses the wrong achievement names, two things break:

1. **In-game:** the overlay never pops an achievement, because the game calls
   `SetAchievement("ACH_SOMETHING")` and the emulator's schema doesn't contain that
   exact name — so the unlock is silently dropped and nothing is written to your save.
2. **In [Achievement Watcher]:** the game either never appears, or appears with no
   icons / wrong names. Worse, Achievement Watcher **auto-blacklists** an appid
   (`cfg/exclusion.db`) the first time its schema fails to load — e.g. before you
   added a working Steam Web API key — and then **silently skips it forever**, even
   after you fix everything else.

This was exactly the case for **ZERO PARADES: For Dead Spies** (appid `2863680`):
the shipped `achievements.json` used fabricated names like `the_whole_sick_crew`
instead of the real Steam names like `ACH_TOGETHER_AGAIN`, had **no icons**, and
the appid had been blacklisted by Achievement Watcher.

### What "fix" does

`achfix fix` rebuilds the schema from the authoritative source — Steam's own
`GetSchemaForGame` API:

- writes a correct `steam_settings/achievements.json` with the **real API names**
  the game actually calls, so unlocks land both in-game and in your save file;
- downloads every **achievement icon** (locked + unlocked) into
  `steam_settings/achievement_images/` and references them locally;
- recovers human-written **descriptions** for hidden achievements (which the public
  API leaves blank) by matching display names against any existing file;
- removes the appid from **Achievement Watcher's blacklist** and restarts it so it
  re-scans.

## Install

Requires **Node.js 18+** (uses the built-in `fetch`). No npm dependencies.

```bash
git clone https://github.com/<you>/goldberg-ach-fix
cd goldberg-ach-fix
npm link        # optional: makes `achfix` available globally
```

Or just run it directly with `node bin/achfix.js <command>`.

### Get a Steam Web API key (recommended)

Grab a free key at <https://steamcommunity.com/dev/apikey> and pass it via `--key`
or the `STEAM_WEB_API_KEY` environment variable. Without a key the tool falls back
to a keyless endpoint that returns less data (often no icons/descriptions).

## Usage

```text
achfix fix --game <path> [--appid <id>] [--key <steamWebApiKey>] [--lang english]
achfix watch
achfix list --game <path> [--appid <id>]
```

### Fix a game

```bash
achfix fix --game "C:\Games\ZERO PARADES - For Dead Spies" --key ABCD1234...
```

- `--appid` is auto-detected from `steam_appid.txt` inside the game folder if omitted.
- The tool finds every `steam_settings` folder sitting next to a `steam_api(64).dll`
  (gbe_fork loads that one first) and writes to all of them, plus backs up any file
  it overwrites as `achievements.json.bak`.
- Pass `--no-aw` to skip the Achievement Watcher steps.

### Live notifications

```bash
achfix watch
```

Watches every emulator save root (`%APPDATA%\GSE Saves`,
`%APPDATA%\Goldberg SteamEmu Saves`, CODEX/RUNE public docs, …) and shows a Windows
toast — with the achievement's icon — the moment a new one is earned. Zero
dependencies; the toast is fired through WinRT via PowerShell.

### Check progress

```bash
achfix list --game "C:\Games\ZERO PARADES - For Dead Spies"
# App 2863680: 3/55 unlocked
#   [x] The Whole Sick Crew
#   [ ] Good Tourist
#   ...
```

## How it compares to Achievement Watcher

[Achievement Watcher] is a great, full-featured GUI tracker — keep using it. This
tool is **complementary** and focused on the part Achievement Watcher can't do for
you: **repairing the emulator-side schema** so the game and the tracker have correct
data in the first place, and **un-stranding** games it has already blacklisted. Run
`achfix fix` once per game, then let Achievement Watcher (or `achfix watch`) track it.

## Supported emulators / formats

Schema generation targets **Goldberg / gbe_fork** (`steam_settings/achievements.json`).
The watcher additionally understands the common save shapes (`earned`/`earned_time`,
`Achieved`/`UnlockTime`) used by Goldberg, gbe_fork, CODEX and RUNE.

## File locations reference

| What | Where |
|------|-------|
| Emulator schema (per game) | `<game>\...\steam_settings\achievements.json` |
| Icons | `<game>\...\steam_settings\achievement_images\` |
| Unlock save state | `%APPDATA%\GSE Saves\<appid>\achievements.json` |
| Achievement Watcher blacklist | `%APPDATA%\Achievement Watcher\cfg\exclusion.db` |
| Achievement Watcher schema cache | `%APPDATA%\Achievement Watcher\steam_cache\schema\` |

## License

MIT. Not affiliated with Valve, Goldberg, gbe_fork, or Achievement Watcher.
Use only with games you own / are entitled to.

[Achievement Watcher]: https://github.com/xan105/Achievement-Watcher
