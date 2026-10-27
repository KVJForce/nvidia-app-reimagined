'use strict';

/**
 * NVIDIA App — Reimagined
 * Zero-dependency local server.
 *
 * Real data:
 *  - GPU + driver telemetry via nvidia-smi
 *  - Steam library discovery via appmanifest_*.acf
 *  - Steam game launching via steam://rungameid/<id>
 *
 * Simulated by design:
 *  - Game optimization presets live inside this app only
 *  - Driver installation is handed off to NVIDIA's official installer
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const COVERS_DIR = path.join(PUBLIC_DIR, 'covers');
const DATA_DIR = path.join(ROOT, 'data');
const LATEST_DRIVER_PATH = path.join(DATA_DIR, 'latest-driver.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const GAME_META = {
  1174180: { genre: 'Action · Adventure', accent: '#c9583d', short: 'RDR2' },
  2483190: { genre: 'Racing · Open world', accent: '#38a6ff', short: 'FH6' },
  2406770: { genre: 'FPS · Horror', accent: '#9b6bff', short: 'BC' },
  954850: { genre: 'Space simulation', accent: '#2b8cff', short: 'KSP2' },
  460920: { genre: 'Sports · Open world', accent: '#5fc6ff', short: 'STEEP' },
  1874170: { genre: 'Snowboarding', accent: '#6ee7ff', short: 'SHRD' },
  3354750: { genre: 'Skateboarding', accent: '#ffb347', short: 'SKATE' },
  314650: { genre: 'Space simulation', accent: '#9e7bff', short: 'SPCE' },
  220200: { genre: 'Simulation · Space', accent: '#2f8fff', short: 'KSP' },
  2569510: { genre: 'Sports · Baseball', accent: '#ff5c5c', short: 'MLB' },
  4128400: { genre: 'Sports · Baseball', accent: '#7ddcff', short: 'EB' },
  655500: { genre: 'Racing · Motocross', accent: '#ff7a3d', short: 'MXB' },
  431960: { genre: 'Utility · Wallpaper', accent: '#5d8cff', short: 'WE' },
};

const EXCLUDED_STEAM_APPS = [
  /^steamworks common redistributables$/i,
  /^steam linux runtime/i,
  /^proton /i,
  /^steamvr$/i,
  /^steam controller/i,
  /^wallpaper engine$/i,
  /^steam link$/i,
];

const DEMO_METRICS = {
  name: 'NVIDIA GeForce RTX 4070',
  driver: '621.01',
  vramTotalMB: 12282,
  vramUsedMB: 4830,
  utilization: 42,
  memoryUtilization: 39,
  temperature: 58,
  powerDraw: 118,
  powerLimit: 200,
  fan: 44,
  clock: 2475,
  memClock: 10501,
  pstate: 'P2',
};

let systemCache = { at: 0, value: null };
let gamesCache = { at: 0, value: null };
let driverCache = null;
const metricHistory = [];
let historyTimer = null;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function round(n, digits = 0) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function num(value) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  if (!cleaned || /n\/a/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, '');
}

function unescapeVdf(s) {
  return s.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function readTextIfExists(file) {
  try {
    return stripBom(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fileIfExists(...parts) {
  const file = path.join(...parts);
  return fs.existsSync(file) ? file : null;
}

async function getJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* NVIDIA telemetry                                                    */
/* ------------------------------------------------------------------ */

const NVIDIA_SMI_CANDIDATES = [
  'nvidia-smi',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  'C:\\Windows\\System32\\nvidia-smi.exe',
];

async function runNvidiaSmi(args) {
  let lastError = null;
  for (const candidate of NVIDIA_SMI_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, args, {
        timeout: 4500,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      lastError = error;
      if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) continue;
      if (error && error.killed) continue;
      // The binary exists but rejected a field; let the caller retry with
      // a smaller query instead of walking every path.
      throw error;
    }
  }
  throw lastError || new Error('nvidia-smi not found');
}

function parseGpuCsv(row, fields) {
  const values = row.split(',').map((v) => v.trim());
  const out = {};
  fields.forEach((field, index) => {
    out[field] = values[index] ?? '';
  });
  return out;
}

async function readSystemInfo() {
  const now = Date.now();
  if (systemCache.value && now - systemCache.at < 900) {
    return systemCache.value;
  }

  const fields = [
    'name',
    'driver_version',
    'memory.total',
    'memory.used',
    'utilization.gpu',
    'utilization.memory',
    'temperature.gpu',
    'power.draw',
    'power.limit',
    'fan.speed',
    'clocks.sm',
    'clocks.mem',
    'pstate',
  ];

  let source = 'live';
  let gpuRow = null;

  try {
    const stdout = await runNvidiaSmi([
      `--query-gpu=${fields.join(',')}`,
      '--format=csv,noheader,nounits',
    ]);
    const firstLine = stdout.split(/\r?\n/).find(Boolean) || '';
    gpuRow = parseGpuCsv(firstLine, fields);
  } catch {
    try {
      const stdout = await runNvidiaSmi([
        '--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,power.limit',
        '--format=csv,noheader,nounits',
      ]);
      const firstLine = stdout.split(/\r?\n/).find(Boolean) || '';
      const fallbackFields = [
        'name',
        'driver_version',
        'memory.total',
        'memory.used',
        'utilization.gpu',
        'temperature.gpu',
        'power.draw',
        'power.limit',
      ];
      gpuRow = parseGpuCsv(firstLine, fallbackFields);
    } catch {
      source = 'demo';
    }
  }

  const gpu = source === 'demo' ? { ...DEMO_METRICS } : {
    name: gpuRow.name || 'NVIDIA GPU',
    driver: gpuRow.driver_version || 'Unknown',
    vramTotalMB: num(gpuRow['memory.total']),
    vramUsedMB: num(gpuRow['memory.used']),
    utilization: num(gpuRow['utilization.gpu']),
    memoryUtilization: num(gpuRow['utilization.memory']),
    temperature: num(gpuRow['temperature.gpu']),
    powerDraw: num(gpuRow['power.draw']),
    powerLimit: num(gpuRow['power.limit']),
    fan: num(gpuRow['fan.speed']),
    clock: num(gpuRow['clocks.sm']),
    memClock: num(gpuRow['clocks.mem']),
    pstate: gpuRow.pstate || null,
  };

  const cpus = os.cpus();
  const cpuModel = cpus.length ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'Unknown CPU';
  const system = {
    hostname: os.hostname(),
    platform: os.platform(),
    os: os.version(),
    osRelease: os.release(),
    arch: os.arch(),
    cpu: cpuModel,
    cpuCores: cpus.length,
    ramGB: round(os.totalmem() / 1024 / 1024 / 1024, 0),
  };

  const value = {
    ok: true,
    source,
    timestamp: now,
    gpu: {
      ...gpu,
      utilization: gpu.utilization == null ? null : clamp(gpu.utilization, 0, 100),
      memoryUtilization: gpu.memoryUtilization == null ? null : clamp(gpu.memoryUtilization, 0, 100),
      vramPercent:
        gpu.vramTotalMB && gpu.vramUsedMB != null
          ? clamp((gpu.vramUsedMB / gpu.vramTotalMB) * 100, 0, 100)
          : null,
      powerPercent:
        gpu.powerLimit && gpu.powerDraw != null
          ? clamp((gpu.powerDraw / gpu.powerLimit) * 100, 0, 100)
          : null,
    },
    system,
  };

  systemCache = { at: now, value };
  return value;
}

/* ------------------------------------------------------------------ */
/* Telemetry history                                                   */
/* ------------------------------------------------------------------ */

function recordMetric(system) {
  const gpu = system && system.gpu;
  if (!gpu) return;
  const last = metricHistory[metricHistory.length - 1];
  if (last && Date.now() - last.t < 1200) return;
  metricHistory.push({
    t: Date.now(),
    utilization: gpu.utilization,
    memoryUtilization: gpu.memoryUtilization,
    vramPercent: gpu.vramPercent,
    temperature: gpu.temperature,
    powerPercent: gpu.powerPercent,
    powerDraw: gpu.powerDraw,
  });
  if (metricHistory.length > 180) metricHistory.splice(0, metricHistory.length - 180);
}

function startTelemetrySampler() {
  if (historyTimer) return;
  const sample = async () => {
    try {
      recordMetric(await readSystemInfo());
    } catch {
      // Telemetry is best-effort; the app falls back to demo data.
    }
  };
  sample();
  historyTimer = setInterval(sample, 2000);
  if (historyTimer.unref) historyTimer.unref();
}

/* ------------------------------------------------------------------ */
/* Driver information                                                  */
/* ------------------------------------------------------------------ */

function versionParts(version) {
  return String(version || '')
    .split('.')
    .map((part) => Number(String(part).replace(/\D/g, '')) || 0);
}

function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function readLatestDriver() {
  const raw = readTextIfExists(LATEST_DRIVER_PATH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getDriverInfo({ check = false } = {}) {
  if (driverCache && !check && Date.now() - driverCache.at < 30_000) {
    return driverCache.value;
  }

  const system = await readSystemInfo();
  const installed = system.gpu.driver || 'Unknown';
  const latest = (await readLatestDriver()) || {
    version: installed,
    type: 'Game Ready Driver',
    branch: 'Installed release',
    releaseDate: null,
    sizeLabel: null,
    whql: true,
    downloadUrl: 'https://www.nvidia.com/en-us/drivers/',
    detailsUrl: 'https://www.nvidia.com/en-us/drivers/',
    highlights: [],
    fixed: [],
  };

  if (check) await sleep(650);

  const updateAvailable =
    installed !== 'Unknown' && latest.version && compareVersions(latest.version, installed) > 0;

  const value = {
    ok: true,
    gpu: system.gpu.name,
    installed,
    latest: latest.version,
    branch: latest.branch || null,
    updateAvailable,
    checkedAt: new Date().toISOString(),
    source: system.source === 'live' ? 'local' : 'demo',
    update: updateAvailable
      ? {
          version: latest.version,
          type: latest.type || 'Game Ready Driver',
          branch: latest.branch || null,
          releaseDate: latest.releaseDate || null,
          sizeLabel: latest.sizeLabel || null,
          whql: latest.whql !== false,
          downloadUrl: latest.downloadUrl || 'https://www.nvidia.com/en-us/drivers/',
          detailsUrl: latest.detailsUrl || 'https://www.nvidia.com/en-us/drivers/',
          highlights: Array.isArray(latest.highlights) ? latest.highlights : [],
          fixed: Array.isArray(latest.fixed) ? latest.fixed : [],
        }
      : null,
  };

  driverCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ */
/* Steam library                                                       */
/* ------------------------------------------------------------------ */

async function findSteamRoots() {
  const roots = new Set();
  const add = (value) => {
    if (!value) return;
    const normalized = path.normalize(String(value).replace(/^"|"$/g, ''));
    roots.add(normalized);
  };

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'reg.exe',
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { timeout: 3000, windowsHide: true }
      );
      const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (match) add(match[1].trim());
    } catch {
      // Registry lookup is best-effort.
    }
  }

  const home = os.homedir();
  add(path.join(home, '.steam', 'steam'));
  add(path.join(home, '.local', 'share', 'Steam'));
  add('C:\\Program Files (x86)\\Steam');
  add('C:\\Program Files\\Steam');
  add(path.join(process.env.LOCALAPPDATA || '', 'Steam'));

  return [...roots].filter((root) => fs.existsSync(path.join(root, 'steamapps')));
}

function parseLibraryFolders(file) {
  const raw = readTextIfExists(file);
  if (!raw) return [];
  const paths = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
  let match;
  while ((match = re.exec(raw))) {
    paths.push(unescapeVdf(match[1]));
  }
  return paths;
}

function parseAppManifest(file) {
  const raw = readTextIfExists(file);
  if (!raw) return null;
  const get = (key) => {
    const match = raw.match(new RegExp(`"${key}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'i'));
    return match ? unescapeVdf(match[1]) : null;
  };
  const getNumber = (key) => {
    const value = get(key);
    return value == null ? null : Number(value);
  };

  const appid = getNumber('appid');
  const name = (get('name') || '')
    .replace(/\uFFFD+/g, ' ')
    .replace(/[\u2122\u00AE]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!appid || !name) return null;

  const stateFlags = getNumber('StateFlags');
  const installed = stateFlags == null || (stateFlags & 4) !== 0;
  if (!installed) return null;

  const sizeBytes = getNumber('SizeOnDisk');
  const lastPlayedSeconds = getNumber('LastPlayed');
  const lastUpdatedSeconds = getNumber('LastUpdated');

  return {
    appid,
    name,
    sizeGB: sizeBytes ? round(sizeBytes / 1024 ** 3, 1) : null,
    lastPlayedMs: lastPlayedSeconds ? lastPlayedSeconds * 1000 : null,
    lastUpdatedMs: lastUpdatedSeconds ? lastUpdatedSeconds * 1000 : null,
    installDir: get('installdir'),
    manifestPath: file,
  };
}

function isExcludedGame(name) {
  return EXCLUDED_STEAM_APPS.some((pattern) => pattern.test(name));
}

function coverForApp(appid, kind = 'portrait') {
  const cover =
    fileIfExists(COVERS_DIR, `${appid}.jpg`) ||
    fileIfExists(COVERS_DIR, `${appid}.png`);
  const hero =
    fileIfExists(PUBLIC_DIR, 'heroes', `${appid}-library_hero.jpg`) ||
    fileIfExists(PUBLIC_DIR, 'heroes', `${appid}-library_hero.png`) ||
    fileIfExists(PUBLIC_DIR, 'heroes', `${appid}-header.jpg`) ||
    fileIfExists(PUBLIC_DIR, 'heroes', `${appid}-header.png`);

  if (kind === 'portrait') {
    if (cover) return `/covers/${path.basename(cover)}`;
    // A wide Steam hero crops surprisingly well into a portrait card and
    // keeps the grid visually complete when no 600x900 cover exists.
    return hero ? `/heroes/${path.basename(hero)}` : null;
  }
  return hero ? `/heroes/${path.basename(hero)}` : null;
}

async function scanSteamGames() {
  const roots = await findSteamRoots();
  const steamappsDirs = new Set();
  for (const root of roots) {
    steamappsDirs.add(path.join(root, 'steamapps'));
    const libraryFile =
      fileIfExists(root, 'steamapps', 'libraryfolders.vdf') ||
      fileIfExists(root, 'config', 'libraryfolders.vdf');
    if (libraryFile) {
      for (const libraryPath of parseLibraryFolders(libraryFile)) {
        steamappsDirs.add(path.join(libraryPath, 'steamapps'));
      }
    }
  }

  const manifests = new Set();
  for (const dir of steamappsDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/^appmanifest_\d+\.acf$/i.test(entry)) {
        manifests.add(path.join(dir, entry));
      }
    }
  }

  const gamesById = new Map();
  for (const manifest of manifests) {
    const game = parseAppManifest(manifest);
    if (!game || isExcludedGame(game.name)) continue;
    const meta = GAME_META[game.appid] || {};
    gamesById.set(String(game.appid), {
      id: String(game.appid),
      appid: game.appid,
      name: game.name,
      sizeGB: game.sizeGB,
      lastPlayedMs: game.lastPlayedMs,
      lastUpdatedMs: game.lastUpdatedMs,
      cover: coverForApp(game.appid, 'portrait'),
      hero: coverForApp(game.appid, 'hero'),
      genre: meta.genre || 'Steam library',
      accent: meta.accent || '#76b900',
      short: meta.short || game.name.slice(0, 2).toUpperCase(),
      source: 'Steam',
    });
  }

  const games = [...gamesById.values()];
  games.sort((a, b) => {
    const recent = (b.lastPlayedMs || 0) - (a.lastPlayedMs || 0);
    if (recent !== 0) return recent;
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    source: 'steam',
    scannedAt: new Date().toISOString(),
    games,
  };
}

async function getGames({ refresh = false } = {}) {
  if (!refresh && gamesCache.value && Date.now() - gamesCache.at < 30_000) {
    return gamesCache.value;
  }
  const value = await scanSteamGames();
  gamesCache = { at: Date.now(), value };
  return value;
}

async function launchGame(appid) {
  const games = await getGames();
  const game = games.games.find((item) => String(item.appid) === String(appid));
  if (!game) {
    return { ok: false, error: 'Game not found in the detected Steam library.' };
  }

  const url = `steam://rungameid/${game.appid}`;
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  return { ok: true, game: game.name, url };
}

/* ------------------------------------------------------------------ */
/* Cover proxy/cache                                                   */
/* ------------------------------------------------------------------ */

function fetchRemoteCover(appid, res) {
  const id = String(appid);
  if (!/^\d{1,12}$/.test(id)) {
    json(res, 400, { ok: false, error: 'Invalid app id.' });
    return;
  }

  const cached =
    fileIfExists(COVERS_DIR, `${id}.jpg`) ||
    fileIfExists(COVERS_DIR, `${id}.png`);
  if (cached) {
    serveFile(res, cached);
    return;
  }

  const remotePath = `/steam/apps/${id}/library_600x900.jpg`;
  const request = https.get(
    {
      hostname: 'cdn.cloudflare.steamstatic.com',
      path: remotePath,
      headers: {
        'User-Agent': 'NVIDIA-App-Reimagined/1.0',
        Accept: 'image/jpeg,image/*',
      },
      timeout: 9000,
    },
    (remote) => {
      if (remote.statusCode !== 200) {
        remote.resume();
        json(res, 404, { ok: false, error: 'Cover not available.' });
        return;
      }
      const chunks = [];
      let size = 0;
      remote.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      remote.on('end', async () => {
        if (size === 0 || res.writableEnded) return;
        const buffer = Buffer.concat(chunks);
        try {
          await fsp.mkdir(COVERS_DIR, { recursive: true });
          await fsp.writeFile(path.join(COVERS_DIR, `${id}.jpg`), buffer);
        } catch {
          // Serving the image is still useful if caching fails.
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(buffer);
      });
    }
  );

  request.on('timeout', () => request.destroy());
  request.on('error', () => {
    if (!res.headersSent) json(res, 404, { ok: false, error: 'Cover unavailable.' });
  });
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

function serveFile(res, filePath, cacheControl = 'no-cache') {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    stream.pipe(res);
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Not found');
  });
}

function safePublicPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const absolute = path.resolve(PUBLIC_DIR, relative);
  const root = path.resolve(PUBLIC_DIR);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Same-origin fetch and simple clients.
  try {
    const parsed = new URL(origin);
    return (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      Number(parsed.port || 80) === PORT
    );
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/system') {
    const system = await readSystemInfo();
    json(res, 200, system);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/history') {
    json(res, 200, { ok: true, samples: metricHistory.slice(-120) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/driver') {
    const check = url.searchParams.get('check') === '1';
    const driver = await getDriverInfo({ check });
    json(res, 200, driver);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/games') {
    const refresh = url.searchParams.get('refresh') === '1';
    const games = await getGames({ refresh });
    json(res, 200, games);
    return true;
  }

  const launchMatch = pathname.match(/^\/api\/games\/(\d+)\/launch$/);
  if (req.method === 'POST' && launchMatch) {
    if (!isAllowedOrigin(req)) {
      json(res, 403, { ok: false, error: 'Origin not allowed.' });
      return true;
    }
    const body = await getJsonBody(req);
    if (body == null) {
      json(res, 400, { ok: false, error: 'Invalid request body.' });
      return true;
    }
    const result = await launchGame(launchMatch[1]);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  const coverMatch = pathname.match(/^\/covers\/(\d+)\.(?:jpg|png)$/);
  if (req.method === 'GET' && coverMatch) {
    fetchRemoteCover(coverMatch[1], res);
    return true;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    json(res, 404, { ok: false, error: 'Unknown API route.' });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (await handleApi(req, res, url)) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
      return;
    }

    const filePath = safePublicPath(url.pathname);
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const cacheControl = /[\\/](covers|heroes|fonts)[\\/]/.test(filePath)
        ? 'public, max-age=604800'
        : 'no-cache';
      serveFile(res, filePath, cacheControl);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found. <a href="/">Open the app</a>.</p>');
  } catch (error) {
    console.error('[nvidia-app] request failed:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ ok: false, error: 'Internal server error.' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  NVIDIA App - Reimagined');
  console.log(`  Local:   http://${HOST}:${PORT}`);
  console.log('  Data:    nvidia-smi + Steam library');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
  startTelemetrySampler();
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
