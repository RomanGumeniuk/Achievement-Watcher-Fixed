'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SAVE_ROOTS } = require('./paths');

// Parse a gbe_fork / Goldberg achievements.json save file into a set of earned names.
// gbe_fork shape: { "<name>": { "earned": true, "earned_time": 123 }, ... }
// Goldberg(old) shape: { "<name>": { "earned": true, "earned_time": 123 } } as well.
function parseEarned(file) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return new Map();
  }
  const earned = new Map();
  for (const [name, v] of Object.entries(json)) {
    if (v && typeof v === 'object' && (v.earned === true || v.Achieved === '1' || v.Achieved === 1)) {
      earned.set(name, Number(v.earned_time || v.UnlockTime || 0));
    }
  }
  return earned;
}

// Load schema (name -> display/icon) written by `fix` into the game folder, so
// notifications can show a pretty title. Falls back to raw api name.
function loadSchemaIndex(steamSettingsDirs) {
  const idx = new Map();
  for (const dir of steamSettingsDirs) {
    const f = path.join(dir, 'achievements.json');
    try {
      for (const a of JSON.parse(fs.readFileSync(f, 'utf8'))) {
        idx.set(a.name, {
          title: (a.displayName && a.displayName.english) || a.name,
          desc: (a.description && a.description.english) || '',
          icon: a.icon ? path.join(dir, a.icon) : null,
        });
      }
    } catch {}
  }
  return idx;
}

function toast(title, message, iconPath) {
  // Zero-dependency Windows toast via WinRT through PowerShell.
  const safe = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const imgXml = iconPath && fs.existsSync(iconPath)
    ? `<image placement="appLogoOverride" hint-crop="circle" src="${safe(iconPath)}"/>`
    : '';
  const ps = `
$ErrorActionPreference='SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$xml = @"
<toast><visual><binding template="ToastGeneric">
${imgXml}
<text>${safe(title)}</text>
<text>${safe(message)}</text>
</binding></visual></toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Goldberg Achievements").Show($toast)
`;
  spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
}

/**
 * Watch every emulator save root for newly earned achievements and fire a
 * desktop toast for each unlock. Returns a stop() function.
 */
function watch({ steamSettingsDirs = [], onUnlock, log = console.log } = {}) {
  const schema = loadSchemaIndex(steamSettingsDirs);
  const state = new Map(); // file -> Set of earned names

  function scanFile(file) {
    const earned = parseEarned(file);
    // Files present at startup are primed into `state` before we start watching,
    // so anything new here is a genuine unlock that happened while we were running.
    const prev = state.get(file) || new Set();
    const fresh = [...earned.keys()].filter((n) => !prev.has(n));
    state.set(file, new Set(earned.keys()));
    for (const name of fresh) {
      const meta = schema.get(name) || { title: name, desc: '', icon: null };
      log(`🏆 Unlocked: ${meta.title}`);
      if (onUnlock) onUnlock({ name, ...meta });
      else toast('🏆 Achievement Unlocked', `${meta.title}${meta.desc ? ' — ' + meta.desc : ''}`, meta.icon);
    }
  }

  const watchers = [];
  const seenFiles = new Set();

  function primeAndWatch(root) {
    if (!fs.existsSync(root)) return;
    // prime existing saves so we only notify on NEW unlocks
    for (const appid of safeReaddir(root)) {
      const f = path.join(root, appid, 'achievements.json');
      if (fs.existsSync(f)) {
        state.set(f, new Set(parseEarned(f).keys()));
        seenFiles.add(f);
      }
    }
    try {
      const w = fs.watch(root, { recursive: true }, (_evt, rel) => {
        if (!rel) return;
        if (!/achievements\.json$/i.test(rel.replace(/\\/g, '/'))) return;
        const file = path.join(root, rel);
        // debounce: emulators write in bursts
        clearTimeout(timers.get(file));
        timers.set(file, setTimeout(() => scanFile(file), 250));
      });
      watchers.push(w);
      log(`Watching ${root}`);
    } catch (e) {
      log(`Could not watch ${root}: ${e.message}`);
    }
  }

  const timers = new Map();
  for (const root of SAVE_ROOTS) primeAndWatch(root);
  log('Ready. Unlock an achievement in-game to test.');

  return () => {
    for (const w of watchers) w.close();
    for (const t of timers.values()) clearTimeout(t);
  };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

module.exports = { watch, parseEarned, toast, loadSchemaIndex };
