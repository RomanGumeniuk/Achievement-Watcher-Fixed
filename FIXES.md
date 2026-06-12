# Fixes in this fork

A precise, reproducible record of what was wrong and what changed, so the patches
can be reviewed or upstreamed.

## Background: how the pieces fit together

When you run a cracked / DRM-free build, a **Steam-API emulator** stands in for
real Steam. The current one is **gbe_fork** (the actively maintained Goldberg
fork). Two files matter:

- **Schema** — `…\steam_settings\achievements.json`, shipped *inside the game*,
  next to `steam_api(64).dll`. It declares which achievements exist, keyed by their
  **Steam API name** (e.g. `ACH_TOGETHER_AGAIN`), with icon references. The game
  unlocks an achievement by calling `SetAchievement("<api name>")`; if that exact
  name isn't in the schema, the call is dropped.
- **Save** — `%APPDATA%\GSE Saves\<appid>\achievements.json`, written by the
  emulator, recording unlock state as `{ "<api name>": { "earned": true,
  "earned_time": <unix> } }`.

Achievement Watcher reads the **save** to know what you unlocked, and fetches the
**schema** from the Steam Web API (`GetSchemaForGame`) for names/icons/descriptions.

---

## Fix 1 — permanent blacklist on transient failure

**File:** `app/parser/achievements.js`, in `makeList()`.

**Before:**

```js
let game = await this.getSavedAchievementsForAppid(option, appid, appidList);
endTime = Date.now();
if (!game) {
  blacklist.add(appid.appid);            // <-- permanent, written to cfg/exclusion.db
  debug.log(`[${appid.appid}] took ${(endTime - startTime) / 1000} seconds.`);
}
```

`getSavedAchievementsForAppid()` returns `undefined` whenever `getGameData()` does,
and `getGameData()` swallows **every** error — missing API key, network failure,
rate-limit, schema CDN down, store fetch failure — and returns `undefined`. So any
one transient hiccup permanently added the appid to `cfg/exclusion.db`.

`discover()` then filters every blacklisted appid out of future scans:

```js
let exclude = await blacklist.get();
data = data.filter((appid) => !exclude.some((id) => id == appid.appid));
```

**Result of the bug:** open a game once before setting the API key → it's
blacklisted → it never appears again, even after the key is set, with no UI hint.

**After:** the `blacklist.add(...)` call is removed; a failed load just logs and is
retried next scan. The manual blacklist action, the hardcoded bogus-list
(Space War, SteamVR, redistributables…) and the server list are untouched, so
intentional exclusions still work.

> Trade-off: a folder that is genuinely not a game is re-attempted each scan
> instead of being remembered. That cost is a single cached/failed lookup per
> scan — far cheaper than the alternative of silently losing real games forever.

---

## Fix 2 — repairing the emulator schema (bundled tool)

This is **not** an Achievement Watcher bug; the broken data is the game's own
`steam_settings/achievements.json`. Common shipping defects:

- file missing entirely (no achievements defined to the emulator);
- **fabricated names** — e.g. `the_whole_sick_crew` instead of the real
  `ACH_TOGETHER_AGAIN`, so the game's `SetAchievement` calls never match;
- **no icons**, so the in-game overlay and trackers have nothing to show.

`tools/goldberg-ach-fix` rebuilds the file from Steam's `GetSchemaForGame`:

1. fetch the authoritative schema (real API names, icons, descriptions);
2. download every icon into `steam_settings/achievement_images/`;
3. recover descriptions for hidden achievements (which the public API leaves
   blank) by matching display names against any pre-existing file;
4. write `achievements.json` into every `steam_settings` next to a `steam_api`
   dll (backing up the old one as `.bak`);
5. remove the appid from Achievement Watcher's blacklist and restart it.

### Worked example: ZERO PARADES: For Dead Spies (appid 2863680)

The shipped schema had 55 achievements under fabricated names with no icons, and
the appid had already been auto-blacklisted by upstream Achievement Watcher.
After `achfix fix`: 55 correct API names, 55 icons downloaded, 42 hidden-achievement
descriptions recovered, appid un-blacklisted — achievements now pop in-game and
show in the tracker.

---

## Fix 3 — crash in `GetMissingData` makes games with hidden achievements vanish

**File:** `app/parser/steam.js`, in `GetMissingData()`.

The Steam schema (`GetSchemaForGame`) legitimately returns **blank descriptions for
hidden achievements**. To fill them, AW does a supplemental "steamhunters" lookup
and maps over the response:

```js
updatedDesc = ipcRenderer.sendSync('get-steam-data', { appid: data.appid, type: 'steamhunters' });
const map = new Map(updatedDesc.achievements.map((item) => [item.name, item.description]));
```

For an obscure title, steamhunters has no entry and the call returns `undefined`,
so `updatedDesc.achievements.map(...)` throws `TypeError: Cannot read property
'map' of undefined`. In the released build this aborts `getGameData()` for that
appid, so the game **silently disappears from the list** on every scan — even
though its schema and save file are perfectly fine.

This bites any game with ≥1 hidden achievement that steamhunters doesn't cover.
Concrete repro: **ZERO PARADES: For Dead Spies** (appid 2863680) has 42 of 55
achievements with blank descriptions; before the fix it failed to load (~31s then
crash), after it loads in ~0.01s.

**Fixed:** guard the supplemental response — only build the map when
`updatedDesc.achievements` is actually an array with entries; otherwise skip
cleanly (and don't flag the cache as needing a rewrite). See the `FIX (fork)`
comment in `GetMissingData`.

## What was checked but is NOT broken

- **gbe_fork save format.** Achievement Watcher's parser already maps
  `earned` → `Achieved` and `earned_time` → `UnlockTime`
  (`app/parser/achievements.js`, in `getSavedAchievementsForAppid`). No change needed.
