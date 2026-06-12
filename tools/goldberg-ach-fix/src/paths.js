'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APPDATA = process.env.APPDATA || '';
const PUBLIC = process.env.Public || 'C:\\Users\\Public';
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';

// Where Steam emulators write per-user unlock state (<root>/<appid>/achievements.json or .ini).
const SAVE_ROOTS = [
  path.join(APPDATA, 'GSE Saves'),
  path.join(APPDATA, 'Goldberg SteamEmu Saves'),
  path.join(APPDATA, 'SmartSteamEmu'),
  path.join(APPDATA, 'EMPRESS'),
  path.join(PUBLIC, 'Documents', 'Steam', 'CODEX'),
  path.join(PUBLIC, 'Documents', 'Steam', 'RUNE'),
  path.join(PUBLIC, 'Documents', 'OnlineFix'),
].filter(Boolean);

const AW_CFG = path.join(APPDATA, 'Achievement Watcher', 'cfg');
const AW_EXE = path.join(LOCALAPPDATA, 'Programs', 'Achievement Watcher', 'Achievement Watcher.exe');

// Find the steam_settings folder a game actually loads. gbe_fork loads the one
// sitting next to steam_api(64).dll first, so prefer that; otherwise create it
// next to the dll we can locate under the game directory.
function findGameSteamSettings(gameDir) {
  const hits = [];
  (function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasDll = entries.some((e) => e.isFile() && /^steam_api(64)?\.dll$/i.test(e.name));
    if (hasDll) hits.push(path.join(dir, 'steam_settings'));
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
  })(gameDir, 0);
  return hits;
}

// Read steam_appid.txt anywhere under the game dir so the user need not pass --appid.
function detectAppId(gameDir) {
  let found = null;
  (function walk(dir, depth) {
    if (found || depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found) return;
      if (e.isFile() && /^steam_appid\.txt$/i.test(e.name)) {
        const v = fs.readFileSync(path.join(dir, e.name), 'utf8').trim();
        if (/^\d+$/.test(v)) found = v;
      }
    }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
  })(gameDir, 0);
  return found;
}

module.exports = { SAVE_ROOTS, AW_CFG, AW_EXE, findGameSteamSettings, detectAppId };
