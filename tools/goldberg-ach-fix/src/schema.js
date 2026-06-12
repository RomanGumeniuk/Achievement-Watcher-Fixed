'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STEAM_SCHEMA_URL = (appid, key, lang) =>
  `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v0002/?key=${key}&appid=${appid}&l=${lang}&format=json`;

// No-key fallback: the community-facing schema endpoint used by SteamDB-style tools.
// Returns less data (no api descriptions for hidden achs) but needs no key.
const STORE_SCHEMA_URL = (appid) =>
  `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&format=json`;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'goldberg-ach-fix' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/key=[^&]+/, 'key=***')}`);
  return res.json();
}

// Download a binary asset to dest unless it already exists with content.
async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
  const res = await fetch(url);
  if (!res.ok) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

/**
 * Fetch the real Steam achievement schema for an appid and turn it into the
 * exact shape gbe_fork / Goldberg expects in steam_settings/achievements.json,
 * downloading every icon into steam_settings/achievement_images/.
 *
 * @returns {Promise<{appid:string, name:string, achievements:object[]}>}
 */
async function buildSchema({ appid, key, lang = 'english', steamSettingsDir, log = () => {} }) {
  appid = String(appid);
  const url = key ? STEAM_SCHEMA_URL(appid, key, lang) : STORE_SCHEMA_URL(appid);
  log(`Fetching schema for ${appid} (${key ? 'with key' : 'no key'})...`);
  const data = await getJson(url);

  const game = data.game || {};
  const list = game.availableGameStats && game.availableGameStats.achievements;
  if (!list || list.length === 0) {
    throw new Error(`No achievements found in Steam schema for appid ${appid}`);
  }
  log(`Schema OK: "${game.gameName || appid}" with ${list.length} achievements.`);

  const imgRel = 'achievement_images';
  const out = [];
  let icons = 0;
  for (const a of list) {
    const entry = {
      name: a.name,
      hidden: a.hidden ? 1 : 0,
      displayName: { english: a.displayName || a.name },
      description: { english: a.description || '' },
    };
    if (a.icon) {
      const f = `${imgRel}/${path.basename(new URL(a.icon).pathname)}`;
      if (await download(a.icon, path.join(steamSettingsDir, f))) {
        entry.icon = f;
        icons++;
      }
    }
    if (a.icongray) {
      const f = `${imgRel}/${path.basename(new URL(a.icongray).pathname)}`;
      if (await download(a.icongray, path.join(steamSettingsDir, f))) entry.icon_gray = f;
    }
    out.push(entry);
  }
  log(`Downloaded ${icons} achievement icons.`);

  return { appid, name: game.gameName || appid, achievements: out };
}

/**
 * Merge human-written descriptions from an existing (possibly mis-named) file
 * into a freshly fetched schema, matching on normalised display name.
 * Lets us keep real-Steam api names + icons while recovering descriptions the
 * public API leaves blank for hidden achievements.
 */
function mergeDescriptions(achievements, oldList) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byName = new Map((oldList || []).map((o) => [norm(o.displayName && o.displayName.english), o]));
  let merged = 0;
  for (const a of achievements) {
    const o = byName.get(norm(a.displayName.english));
    if (o && o.description && o.description.english && !a.description.english) {
      a.description = { english: o.description.english };
      merged++;
    }
  }
  return merged;
}

module.exports = { buildSchema, mergeDescriptions, download, getJson };
