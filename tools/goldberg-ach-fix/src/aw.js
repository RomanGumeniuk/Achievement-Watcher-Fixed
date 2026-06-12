'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { AW_CFG, AW_EXE } = require('./paths');

// Achievement Watcher auto-blacklists an appid (cfg/exclusion.db) the moment its
// schema fails to load even once -- e.g. before a working Steam Web API key was
// set. Once blacklisted the game is silently skipped forever. This removes it.
function unblacklist(appid) {
  appid = String(appid);
  const file = path.join(AW_CFG, 'exclusion.db');
  if (!fs.existsSync(file)) return { changed: false, reason: 'no exclusion.db' };
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { changed: false, reason: 'unreadable exclusion.db' };
  }
  if (!Array.isArray(list) || !list.map(String).includes(appid)) {
    return { changed: false, reason: 'not blacklisted' };
  }
  const next = list.filter((x) => String(x) !== appid);
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return { changed: true };
}

function isInstalled() {
  return fs.existsSync(AW_EXE);
}

function restart() {
  if (!isInstalled()) return false;
  spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-Process 'Achievement Watcher' -ErrorAction SilentlyContinue | Stop-Process -Force; ` +
    `Start-Sleep -Seconds 2; Start-Process '${AW_EXE}'`,
  ], { stdio: 'ignore', detached: true }).unref();
  return true;
}

module.exports = { unblacklist, restart, isInstalled };
