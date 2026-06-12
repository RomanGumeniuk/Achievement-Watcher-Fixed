#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, mergeDescriptions } = require('../src/schema');
const { findGameSteamSettings, detectAppId, SAVE_ROOTS } = require('../src/paths');
const { watch, parseEarned, loadSchemaIndex } = require('../src/watcher');
const aw = require('../src/aw');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

const HELP = `goldberg-ach-fix — make Goldberg/gbe_fork achievements actually work

Usage:
  achfix fix --game <path> [--appid <id>] [--key <steamWebApiKey>] [--lang english]
      Fetch the real Steam achievement schema, write a correct
      steam_settings/achievements.json (proper API names + icons + descriptions)
      into the game, and un-blacklist it in Achievement Watcher.

  achfix watch
      Show a desktop notification whenever any emulated game unlocks an achievement.

  achfix list --game <path> [--appid <id>]
      Print unlock progress for one game from its save file.

Options:
  --key   Steam Web API key (https://steamcommunity.com/dev/apikey).
          Optional but strongly recommended; without it descriptions/icons are limited.
  --no-aw Skip the Achievement Watcher un-blacklist + restart step.

Examples:
  achfix fix --game "C:\\Games\\ZERO PARADES - For Dead Spies" --key ABCD1234
  achfix watch
`;

async function cmdFix(args) {
  const gameDir = args.game;
  if (!gameDir || !fs.existsSync(gameDir)) {
    console.error('Error: --game <path> is required and must exist.');
    process.exit(1);
  }
  const appid = String(args.appid || detectAppId(gameDir) || '');
  if (!/^\d+$/.test(appid)) {
    console.error('Error: could not detect appid. Pass --appid <id>.');
    process.exit(1);
  }
  const key = args.key && args.key !== true ? args.key : process.env.STEAM_WEB_API_KEY || '';
  const lang = (args.lang && args.lang !== true) ? args.lang : 'english';

  // Target every steam_settings next to a steam_api dll, plus the global save copy.
  let targets = findGameSteamSettings(gameDir);
  if (targets.length === 0) {
    // no dll found via walk: write next to the game root as a last resort
    targets = [path.join(gameDir, 'steam_settings')];
    console.warn('Warning: no steam_api(64).dll found under the game folder; writing to', targets[0]);
  }
  for (const t of targets) fs.mkdirSync(t, { recursive: true });

  // Build schema once (downloading icons into the first target), reuse JSON for the rest.
  const primary = targets[0];
  const { name, achievements } = await buildSchema({
    appid, key, lang, steamSettingsDir: primary, log: (m) => console.log('  ' + m),
  });

  // Recover descriptions from any pre-existing (often mis-named) file we can find.
  for (const dir of [...targets, ...SAVE_ROOTS.map((r) => path.join(r, 'steam_settings'))]) {
    const old = path.join(dir, 'achievements.json');
    if (fs.existsSync(old)) {
      try {
        const merged = mergeDescriptions(achievements, JSON.parse(fs.readFileSync(old, 'utf8')));
        if (merged) { console.log(`  Recovered ${merged} descriptions from ${old}`); break; }
      } catch {}
    }
  }

  const json = JSON.stringify(achievements, null, 2);
  for (const t of targets) {
    // back up an existing file once, then write
    const f = path.join(t, 'achievements.json');
    if (fs.existsSync(f) && !fs.existsSync(f + '.bak')) fs.copyFileSync(f, f + '.bak');
    fs.writeFileSync(f, json);
    fs.writeFileSync(path.join(t, 'steam_appid.txt'), appid);
    console.log(`  Wrote ${f}`);
  }
  // copy icons to any secondary targets that lack them
  const imgSrc = path.join(primary, 'achievement_images');
  if (fs.existsSync(imgSrc)) {
    for (const t of targets.slice(1)) {
      const dst = path.join(t, 'achievement_images');
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(imgSrc)) {
        const d = path.join(dst, f);
        if (!fs.existsSync(d)) fs.copyFileSync(path.join(imgSrc, f), d);
      }
    }
  }

  console.log(`\n✔ Schema for "${name}" (${achievements.length} achievements) installed.`);

  if (args.aw !== false && args['no-aw'] !== true) {
    const r = aw.unblacklist(appid);
    if (r.changed) console.log(`✔ Removed ${appid} from Achievement Watcher blacklist.`);
    else console.log(`• Achievement Watcher blacklist: ${r.reason}.`);
    if (aw.isInstalled()) {
      aw.restart();
      console.log('✔ Restarting Achievement Watcher so it re-scans.');
    }
  }
  console.log('\nDone. Launch the game and unlock an achievement to verify.');
}

async function cmdList(args) {
  const gameDir = args.game;
  const appid = String(args.appid || (gameDir && detectAppId(gameDir)) || '');
  if (!/^\d+$/.test(appid)) {
    console.error('Error: pass --appid <id> (or --game <path> containing steam_appid.txt).');
    process.exit(1);
  }
  const schema = loadSchemaIndex(
    gameDir ? findGameSteamSettings(gameDir) : SAVE_ROOTS.map((r) => path.join(r, 'steam_settings'))
  );
  let saveFile = null;
  for (const root of SAVE_ROOTS) {
    const f = path.join(root, appid, 'achievements.json');
    if (fs.existsSync(f)) { saveFile = f; break; }
  }
  const earned = saveFile ? parseEarned(saveFile) : new Map();
  const total = schema.size || earned.size;
  console.log(`App ${appid}: ${earned.size}/${total || '?'} unlocked${saveFile ? '' : ' (no save file found yet)'}`);
  if (schema.size) {
    for (const [name, meta] of schema) {
      const got = earned.has(name);
      console.log(`  [${got ? 'x' : ' '}] ${meta.title}`);
    }
  } else {
    for (const name of earned.keys()) console.log(`  [x] ${name}`);
  }
}

function cmdWatch() {
  const dirs = [];
  for (const root of SAVE_ROOTS) {
    const ss = path.join(root, 'steam_settings');
    if (fs.existsSync(ss)) dirs.push(ss);
  }
  console.log('goldberg-ach-fix watcher — desktop notifications for emulated unlocks.\n');
  const stop = watch({ steamSettingsDirs: dirs });
  process.on('SIGINT', () => { stop(); process.exit(0); });
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === 'fix') await cmdFix(args);
    else if (cmd === 'watch') cmdWatch();
    else if (cmd === 'list') await cmdList(args);
    else console.log(HELP);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
})();
