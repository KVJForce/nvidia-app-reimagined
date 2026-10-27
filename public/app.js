'use strict';

/* ==========================================================================
   NVIDIA App — Reimagined
   Vanilla JS. No framework, no build step.
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ROUTES = ['home', 'drivers', 'games', 'performance', 'settings'];
const ROUTE_TITLES = {
  home: 'Home',
  drivers: 'Drivers',
  games: 'Games',
  performance: 'Performance',
  settings: 'Settings',
};

const STORAGE = {
  prefs: 'nvidia-app.prefs.v1',
  profiles: 'nvidia-app.games.v1',
};

const DEFAULT_PREFS = {
  notifications: true,
  autoCheck: true,
  overlay: true,
  overlayHotkey: 'Alt + R',
  launchAtStartup: false,
  reducedMotion: false,
};

const PRESETS = {
  performance: {
    key: 'performance',
    label: 'Performance',
    note: 'Highest FPS',
    icon: 'zap',
    description: 'Lean settings for maximum frame rate.',
    settings: {
      'Texture quality': 'Medium',
      'Shadows': 'Low',
      'Effects': 'Medium',
      'Upscaling': 'Performance',
      'Frame cap': 'Unlimited',
    },
  },
  balanced: {
    key: 'balanced',
    label: 'Balanced',
    note: 'Recommended',
    icon: 'sparkles',
    description: 'A sharp image with a steady frame rate.',
    settings: {
      'Texture quality': 'High',
      'Shadows': 'Medium',
      'Effects': 'High',
      'Upscaling': 'Balanced',
      'Frame cap': 'Display',
    },
  },
  quality: {
    key: 'quality',
    label: 'Quality',
    note: 'Best visuals',
    icon: 'spark',
    description: 'Push image quality as far as your GPU allows.',
    settings: {
      'Texture quality': 'Ultra',
      'Shadows': 'High',
      'Effects': 'Ultra',
      'Upscaling': 'Quality',
      'Frame cap': 'Off',
    },
  },
};

const state = {
  route: 'home',
  booted: false,
  system: null,
  driver: null,
  games: [],
  gamesSource: 'loading',
  gamesScannedAt: null,
  history: [],
  search: '',
  filter: 'all',
  sort: 'recent',
  selectedGameId: null,
  sheetPreset: 'balanced',
  homePreset: 'balanced',
  prefs: loadJSON(STORAGE.prefs, { ...DEFAULT_PREFS }),
  profiles: loadJSON(STORAGE.profiles, null),
  driverChecking: false,
  live: true,
  paletteItems: [],
  paletteIndex: 0,
  paletteQuery: '',
  confirmAction: null,
  lastFocus: null,
};

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the app still works for this session.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function icon(name, className = '') {
  return `<svg${className ? ` class="${className}"` : ''} aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function display(value, suffix = '') {
  return num(value) == null ? '—' : `${Math.round(value)}${suffix}`;
}

function display1(value, suffix = '') {
  return num(value) == null ? '—' : `${Math.round(value * 10) / 10}${suffix}`;
}

function gpuShortName(name) {
  return String(name || 'NVIDIA GPU')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/^GeForce\s+/i, 'GeForce ');
}

function formatSize(sizeGB) {
  if (num(sizeGB) == null || sizeGB <= 0) return '—';
  if (sizeGB >= 100) return `${Math.round(sizeGB)} GB`;
  return `${Math.round(sizeGB * 10) / 10} GB`;
}

function relativeTime(ms) {
  if (!ms) return 'Never played';
  const diff = Date.now() - Number(ms);
  if (diff < 0) return 'Just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function releaseDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getGame(id) {
  return state.games.find((game) => String(game.id) === String(id)) || null;
}

function profileFor(id) {
  return (state.profiles && state.profiles[String(id)]) || null;
}

function isOptimized(id) {
  return Boolean(profileFor(id));
}

function gamesWithArt() {
  return state.games.filter((game) => game.hero || game.cover);
}

function gpu() {
  return state.system && state.system.gpu ? state.system.gpu : null;
}

function systemInfo() {
  return state.system && state.system.system ? state.system.system : null;
}

function dataSourceLabel() {
  return state.system && state.system.source === 'live' ? 'Live' : 'Demo data';
}

function isLive() {
  return Boolean(state.system && state.system.source === 'live');
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

/* --------------------------------------------------------------------------
   Metrics
   -------------------------------------------------------------------------- */

function metricFromSystem(system) {
  if (!system || !system.gpu) return null;
  return {
    t: system.timestamp || Date.now(),
    utilization: num(system.gpu.utilization),
    memoryUtilization: num(system.gpu.memoryUtilization),
    vramPercent: num(system.gpu.vramPercent),
    temperature: num(system.gpu.temperature),
    powerPercent: num(system.gpu.powerPercent),
    powerDraw: num(system.gpu.powerDraw),
  };
}

function pushMetric(sample) {
  if (!sample) return;
  const last = state.history[state.history.length - 1];
  if (last && Math.abs(last.t - sample.t) < 900) return;
  state.history.push(sample);
  if (state.history.length > 180) state.history.shift();
}

function seedHistory(samples) {
  if (!Array.isArray(samples)) return;
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') continue;
    pushMetric({
      t: Number(sample.t) || Date.now(),
      utilization: num(sample.utilization),
      memoryUtilization: num(sample.memoryUtilization),
      vramPercent: num(sample.vramPercent),
      temperature: num(sample.temperature),
      powerPercent: num(sample.powerPercent),
      powerDraw: num(sample.powerDraw),
    });
  }
  state.history.sort((a, b) => a.t - b.t);
}

/* --------------------------------------------------------------------------
   Preferences and profiles
   -------------------------------------------------------------------------- */

function applyPreferences() {
  document.documentElement.dataset.motion = state.prefs.reducedMotion ? 'reduced' : 'full';
  document.documentElement.style.colorScheme = 'dark';
}

function togglePref(key) {
  if (!(key in DEFAULT_PREFS) || typeof DEFAULT_PREFS[key] !== 'boolean') return;
  state.prefs[key] = !state.prefs[key];
  saveJSON(STORAGE.prefs, state.prefs);
  applyPreferences();
  updateChrome();
  if (state.route === 'settings' || state.route === 'performance') renderRoute({ scroll: false });
  toast(
    'Preference updated',
    `${prettyPrefName(key)} is now ${state.prefs[key] ? 'on' : 'off'}.`,
    'info'
  );
}

function prettyPrefName(key) {
  return ({
    notifications: 'Driver notifications',
    autoCheck: 'Automatic driver checks',
    overlay: 'Performance overlay',
    launchAtStartup: 'Launch at startup',
    reducedMotion: 'Reduced motion',
  })[key] || key;
}

function seedProfilesIfNeeded() {
  if (state.profiles !== null) return;
  state.profiles = {};
  const preferred = ['1174180', '2483190', '2406770'];
  const picks = preferred.filter((id) => getGame(id));
  if (picks.length === 0) {
    const recent = state.games.filter((game) => game.lastPlayedMs).slice(0, 2);
    picks.push(...recent.map((game) => String(game.id)));
  }
  for (const id of picks) {
    state.profiles[id] = { preset: 'balanced', overlay: true, updatedAt: Date.now() };
  }
  saveJSON(STORAGE.profiles, state.profiles);
}

function setProfilePreset(id, presetKey) {
  if (!PRESETS[presetKey]) return;
  state.profiles = state.profiles || {};
  state.profiles[String(id)] = {
    ...(state.profiles[String(id)] || { overlay: true }),
    preset: presetKey,
    updatedAt: Date.now(),
  };
  saveJSON(STORAGE.profiles, state.profiles);
}

function toggleProfile(id) {
  state.profiles = state.profiles || {};
  const key = String(id);
  if (state.profiles[key]) {
    delete state.profiles[key];
  } else {
    state.profiles[key] = { preset: 'balanced', overlay: true, updatedAt: Date.now() };
  }
  saveJSON(STORAGE.profiles, state.profiles);
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

function toast(title, message = '', type = 'success', duration = 4200) {
  const root = $('#toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' is-error' : type === 'info' ? ' is-info' : ''}`;
  const glyph = type === 'error' ? 'info' : type === 'info' ? 'info' : 'check-circle';
  node.innerHTML = `
    <span class="toast-icon">${icon(glyph)}</span>
    <span class="toast-copy"><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ''}</span>
    <button class="toast-close" type="button" aria-label="Dismiss notification">${icon('close')}</button>
  `;
  root.appendChild(node);
  const remove = () => {
    if (!node.isConnected) return;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 260);
  };
  const timer = setTimeout(remove, duration);
  $('.toast-close', node).addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  const nodes = $$('.toast', root);
  if (nodes.length > 3) nodes.slice(0, nodes.length - 3).forEach((old) => old.remove());
}

/* --------------------------------------------------------------------------
   Shell rendering
   -------------------------------------------------------------------------- */

function updateChrome() {
  const route = state.route;
  $$('.nav-item[data-nav]').forEach((item) => {
    const active = item.dataset.nav === route;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  const pageLabel = $('#topbar-page');
  if (pageLabel) pageLabel.textContent = ROUTE_TITLES[route] || 'Home';
  document.title = `${ROUTE_TITLES[route] || 'Home'} · NVIDIA App`;

  const hasUpdate = Boolean(state.driver && state.driver.updateAvailable && state.prefs.notifications);
  const badge = $('#nav-driver-badge');
  if (badge) badge.hidden = !hasUpdate;
  const dot = $('#notification-dot');
  if (dot) dot.hidden = !hasUpdate;
  renderSidebarGpu();
}

function renderSidebarGpu() {
  const host = $('#sidebar-gpu');
  if (!host) return;
  const device = gpu();
  if (!device) {
    host.innerHTML = `
      <div class="skeleton skeleton-line skeleton-line-sm"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line skeleton-line-md"></div>
    `;
    return;
  }

  const load = num(device.utilization);
  const usedGB = num(device.vramUsedMB) == null ? null : device.vramUsedMB / 1024;
  const totalGB = num(device.vramTotalMB) == null ? null : device.vramTotalMB / 1024;
  const vram = usedGB == null ? '—' : `${display1(usedGB)} / ${totalGB ? Math.round(totalGB) : '—'} GB`;

  host.innerHTML = `
    <div class="gpu-status-top">
      <span class="gpu-status-label" title="${esc(device.name)}">${esc(gpuShortName(device.name))}</span>
      <span class="live-dot" aria-label="${isLive() ? 'Live telemetry' : 'Demo telemetry'}"></span>
    </div>
    <div class="gpu-status-row">
      <strong>${display(device.temperature, '°')}</strong>
      <span>${load == null ? '—' : `${Math.round(load)}%`} load</span>
    </div>
    <div class="meter meter-sm" role="progressbar" aria-label="GPU utilization" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${load == null ? 0 : Math.round(load)}">
      <i style="width:${load == null ? 0 : clamp(load, 1, 100)}%"></i>
    </div>
    <div class="gpu-status-meta">
      <span>${vram}</span>
      <span>${display(device.powerDraw, ' W')}</span>
      <span>Driver ${esc(device.driver || '—')}</span>
    </div>
  `;
}

function renderRoute({ scroll = true } = {}) {
  if (!state.booted) return;
  const view = $('#view');
  if (!view) return;

  const renderers = {
    home: renderHome,
    drivers: renderDrivers,
    games: renderGames,
    performance: renderPerformance,
    settings: renderSettings,
  };
  const renderer = renderers[state.route] || renderHome;
  view.innerHTML = renderer();
  view.removeAttribute('aria-busy');
  updateChrome();

  if (scroll) view.scrollTop = 0;
  requestAnimationFrame(drawRouteVisuals);
}

function drawRouteVisuals() {
  drawSparks();
  if (state.route === 'performance') drawPerfChart();
}

/* --------------------------------------------------------------------------
   Home
   -------------------------------------------------------------------------- */

function statCard({ label, iconName, value, unit, meterValue, footLeft, footRight, id }) {
  const width = meterValue == null ? 0 : clamp(meterValue, 0, 100);
  return `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-label">${icon(iconName)} ${label}</span>
        <span class="stat-delta">${footRight || 'Now'}</span>
      </div>
      <div class="stat-value" id="${id}">${value}${unit ? `<small>${unit}</small>` : ''}</div>
      <div class="meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}">
        <i id="${id}-meter" style="width:${width}%"></i>
      </div>
      <div class="stat-foot"><span id="${id}-foot">${footLeft || '—'}</span><span>${isLive() ? 'Live' : 'Demo'}</span></div>
    </article>
  `;
}

function renderHome() {
  const device = gpu();
  const driver = state.driver;
  const hasUpdate = Boolean(driver && driver.updateAvailable);
  const artGame = gamesWithArt().slice().sort((a, b) => (b.lastPlayedMs || 0) - (a.lastPlayedMs || 0))[0];
  const heroArt = artGame ? artGame.hero || artGame.cover : null;
  const load = num(device && device.utilization);
  const temp = num(device && device.temperature);
  const fan = num(device && device.fan);
  const vramUsed = num(device && device.vramUsedMB);
  const vramTotal = num(device && device.vramTotalMB);
  const power = num(device && device.powerDraw);
  const powerLimit = num(device && device.powerLimit);
  const clock = num(device && device.clock);
  const preset = PRESETS[state.homePreset] || PRESETS.balanced;
  const recents = getRecentGames(3);
  const tunedCount = Object.keys(state.profiles || {}).length;

  const intro = hasUpdate
    ? 'A fresh Game Ready Driver is ready for your rig.'
    : 'Everything is current. Pick a game and get straight to it.';

  return `
    <div class="page home-page">
      <section class="hero-card">
        <div class="hero-bg"${heroArt ? ` style="background-image:url('${esc(heroArt)}')"` : ''}></div>
        <div class="hero-shade"></div>
        <div class="hero-copy">
          <div class="hero-kicker">
            <span class="status-pill is-live">${icon('spark')} ${hasUpdate ? 'Update ready' : 'System ready'}</span>
            <span>${esc(device ? gpuShortName(device.name) : 'NVIDIA GPU')}</span>
          </div>
          <h1 class="hero-title">${greeting()}.<br><span>${hasUpdate ? 'Your next driver is here.' : 'Your rig is ready.'}</span></h1>
          <p class="hero-sub">${esc(intro)} Live telemetry, your Steam library, and one clean place to tune a session.</p>
          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" type="button" data-route="${hasUpdate ? 'drivers' : 'games'}">
              ${icon(hasUpdate ? 'download' : 'gamepad')} ${hasUpdate ? `Update to ${esc(driver.update ? driver.update.version : '')}` : 'Browse your games'}
            </button>
            <button class="btn btn-glass btn-lg" type="button" data-route="${hasUpdate ? 'games' : 'drivers'}">
              ${hasUpdate ? `${icon('gamepad')} Jump into a game` : `${icon('refresh')} Check drivers`}
            </button>
          </div>
          <div class="hero-meta">
            <span>${icon('thermometer')} ${display(temp, '°C')}</span>
            <span>${icon('memory')} ${vramUsed == null || vramTotal == null ? '—' : `${display1(vramUsed / 1024)} / ${Math.round(vramTotal / 1024)} GB`}</span>
            <span>${icon('download')} ${hasUpdate && driver.update ? `${esc(driver.update.version)} available` : `Driver ${esc(driver ? driver.installed : '—')}`}</span>
            <span>${icon('activity')} ${isLive() ? 'nvidia-smi live' : 'Preview data'}</span>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="orb">
            <div class="orb-ring"></div>
            <div class="orb-ring orb-ring-2"></div>
            <div class="orb-core">${icon('spark')}</div>
          </div>
          <div class="orb-chip orb-chip-a"><strong>${display(temp, '°')}</strong><small>GPU temp</small></div>
          <div class="orb-chip orb-chip-b"><strong>${load == null ? '—' : Math.round(load)}%</strong><small>Load</small></div>
          <div class="orb-chip orb-chip-c"><strong>${display(power, ' W')}</strong><small>Power</small></div>
        </div>
      </section>

      <div class="stat-strip">
        ${statCard({
          label: 'GPU load',
          iconName: 'gauge',
          value: load == null ? '—' : Math.round(load),
          unit: '%',
          meterValue: load,
          footLeft: clock == null ? 'Clock unavailable' : `${Math.round(clock)} MHz`,
          footRight: device && device.pstate ? device.pstate : 'Now',
          id: 'live-util',
        })}
        ${statCard({
          label: 'Temperature',
          iconName: 'thermometer',
          value: temp == null ? '—' : Math.round(temp),
          unit: '°C',
          meterValue: temp == null ? null : (temp / 90) * 100,
          footLeft: fan == null || fan === 0 ? 'Fan idle' : `Fan ${Math.round(fan)}%`,
          footRight: 'Sensor',
          id: 'live-temp',
        })}
        ${statCard({
          label: 'VRAM in use',
          iconName: 'memory',
          value: vramUsed == null ? '—' : display1(vramUsed / 1024),
          unit: 'GB',
          meterValue: device && device.vramPercent,
          footLeft: vramTotal == null ? 'Total unavailable' : `${Math.round(vramTotal / 1024)} GB total`,
          footRight: device && device.vramPercent != null ? `${Math.round(device.vramPercent)}%` : 'Now',
          id: 'live-vram',
        })}
        ${statCard({
          label: 'Board power',
          iconName: 'zap',
          value: power == null ? '—' : Math.round(power),
          unit: 'W',
          meterValue: device && device.powerPercent,
          footLeft: powerLimit == null ? 'Limit unavailable' : `${Math.round(powerLimit)} W limit`,
          footRight: 'Realtime',
          id: 'live-power',
        })}
      </div>

      <div class="home-grid">
        <section class="card card-pad span-7 recent-card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Jump back in</h2>
              <p class="card-sub">Your most recent Steam sessions</p>
            </div>
            <button class="card-link" type="button" data-route="games">Open library ${icon('arrow-right')}</button>
          </div>
          ${recents.length ? `
            <div class="recent-grid">
              ${recents.map((game) => renderRecentGame(game)).join('')}
            </div>
          ` : `
            <div class="empty-state" style="min-height:214px">
              <span class="empty-icon">${icon('gamepad')}</span>
              <h3>No Steam games found</h3>
              <p>Install a game or rescan the library from the Games page.</p>
              <button class="btn btn-secondary btn-sm" type="button" data-route="games">Open library</button>
            </div>
          `}
        </section>

        <section class="card card-pad span-5 optimize-card">
          <div class="tune-head">
            <span class="tune-icon">${icon('sparkles')}</span>
            <div>
              <h3>Quick tune</h3>
              <p>Preview a profile for your next session${tunedCount ? ` · ${tunedCount} saved` : ''}</p>
            </div>
          </div>
          <div class="preset-grid" role="group" aria-label="Optimization preset preview">
            ${Object.values(PRESETS).map((item) => `
              <button class="preset-option${item.key === state.homePreset ? ' is-active' : ''}" type="button" data-home-preset="${item.key}">
                <strong>${item.label}</strong>
                <small>${item.note}</small>
              </button>
            `).join('')}
          </div>
          <div class="tune-list" id="home-tune-list">
            ${Object.entries(preset.settings).slice(0, 4).map(([key, value]) => `
              <div class="tune-row"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>
            `).join('')}
          </div>
          <div class="tune-foot">
            <p class="tune-note">App-local profiles.<br>Game files stay untouched.</p>
            <button class="btn btn-secondary btn-sm" type="button" data-route="games">Open library ${icon('arrow-right')}</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function shortHighlight(text) {
  if (!text) return '';
  return String(text)
    .replace(/^Game Ready for /i, 'support for ')
    .replace(/\.$/, '');
}

function driverHeadline(text) {
  if (!text) return 'Built for the latest game releases.';
  return String(text).replace(/^Game Ready for /i, 'Built for ');
}

function getRecentGames(limit) {
  const seen = new Set();
  const output = [];
  const sorted = state.games
    .filter((game) => game.lastPlayedMs)
    .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs);
  for (const game of sorted) {
    if (output.length >= limit) break;
    if (!game.cover && !game.hero) continue;
    output.push(game);
    seen.add(String(game.id));
  }
  if (output.length < limit) {
    for (const game of gamesWithArt()) {
      if (output.length >= limit) break;
      if (seen.has(String(game.id))) continue;
      output.push(game);
      seen.add(String(game.id));
    }
  }
  return output;
}

function renderRecentGame(game) {
  const art = game.hero || game.cover;
  return `
    <article class="recent-game" data-game-id="${esc(game.id)}" tabindex="0" aria-label="Open ${esc(game.name)}">
      <div class="recent-game-bg" style="background-image:url('${esc(art)}')"></div>
      <button class="recent-play" type="button" data-play-id="${esc(game.id)}" aria-label="Play ${esc(game.name)}">${icon('play')}</button>
      <div class="recent-game-copy">
        <strong>${esc(game.name)}</strong>
        <small>${icon('clock')} ${esc(relativeTime(game.lastPlayedMs))}${game.genre ? ` · ${esc(game.genre.split(' · ')[0])}` : ''}</small>
      </div>
    </article>
  `;
}

/* --------------------------------------------------------------------------
   Drivers
   -------------------------------------------------------------------------- */

function renderDrivers() {
  const driver = state.driver || {
    installed: gpu() && gpu().driver ? gpu().driver : '—',
    latest: '—',
    branch: null,
    updateAvailable: false,
    update: null,
  };
  const update = driver.update;
  const hasUpdate = Boolean(driver.updateAvailable && update);
  const version = hasUpdate ? update.version : driver.latest || driver.installed;
  const highlights = hasUpdate && Array.isArray(update.highlights) ? update.highlights : [];
  const fixed = hasUpdate && Array.isArray(update.fixed) ? update.fixed : [];

  return `
    <div class="page drivers-page">
      <div class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">Driver center</span>
          <h1 class="page-title">Stay current. Stay fast.</h1>
          <p class="page-sub">One Game Ready Driver, checked against your GPU. No accounts, no bloat, no guesswork.</p>
        </div>
        <div class="page-actions">
          <span class="status-pill ${hasUpdate ? 'is-warn' : 'is-live'}">
            ${icon(hasUpdate ? 'download' : 'check-circle')} ${hasUpdate ? 'Update available' : 'Up to date'}
          </span>
          <button class="btn btn-secondary ${state.driverChecking ? 'is-busy' : ''}" type="button" data-action="check-drivers" ${state.driverChecking ? 'disabled' : ''}>
            ${icon('refresh')} ${state.driverChecking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      <section class="driver-hero">
        <div class="driver-hero-copy">
          <div class="driver-status">
            <span class="live-dot"></span>
            ${hasUpdate ? 'New release available' : 'Your driver is current'}
          </div>
          <h2>${hasUpdate ? 'Game Ready Driver' : 'Installed driver'} <span>${esc(version)}</span></h2>
          <p>
            ${hasUpdate
              ? `NVIDIA's ${esc(update.type || 'Game Ready Driver')} ${esc(update.version)} is ready. ${esc(driverHeadline(highlights[0]))} The official installer opens in one click.`
              : `You are running the latest detected release. Your GPU, driver, and game library are all in sync.`}
          </p>
          <div class="driver-actions">
            ${hasUpdate
              ? `<button class="btn btn-primary btn-lg" type="button" data-action="open-driver-modal">${icon('download')} Download update</button>
                 <a class="btn btn-glass btn-lg" href="${esc(update.detailsUrl || 'https://www.nvidia.com/en-us/drivers/')}" target="_blank" rel="noopener noreferrer">${icon('external')} Release notes</a>`
              : `<button class="btn btn-primary btn-lg" type="button" data-action="open-driver-modal">${icon('download')} Open NVIDIA drivers</button>
                 <button class="btn btn-glass btn-lg" type="button" data-route="performance">${icon('activity')} View performance</button>`}
          </div>
          <div class="driver-meta-list">
            <span class="chip">${icon('shield')} WHQL certified</span>
            <span class="chip">${icon('chip')} ${esc(driver.branch || 'Game Ready')}</span>
            <span class="chip">${icon('monitor')} Windows 10 / 11</span>
            <span class="chip">${icon('download')} ${esc(hasUpdate ? update.sizeLabel || '—' : 'Installed')}</span>
          </div>
        </div>
        <div class="driver-hero-side">
          <div class="driver-version-card">
            <div class="version-installed">
              <span>Installed now</span>
              <strong>${esc(driver.installed || '—')}</strong>
            </div>
            <div class="version-divider"><span>${icon('arrow-right')}</span></div>
            <div class="version-latest">
              <div>
                <small>${hasUpdate ? 'Available' : 'Current release'}</small>
                <strong>${esc(version)}</strong>
              </div>
              <span class="status-pill ${hasUpdate ? 'is-live' : ''}">${hasUpdate ? 'NEW' : 'LATEST'}</span>
            </div>
            <div class="version-foot">
              <span>${icon('shield')} ${hasUpdate ? 'WHQL signed' : 'Verified locally'}</span>
              <span>${hasUpdate ? esc(update.sizeLabel || '') : esc(releaseDate(update ? update.releaseDate : null))}</span>
            </div>
          </div>
        </div>
      </section>

      <div class="driver-layout">
        <section class="card card-pad whats-new">
          <div class="card-head">
            <div>
              <h2 class="card-title">${hasUpdate ? `What's new in ${esc(version)}` : 'Release information'}</h2>
              <p class="card-sub">${hasUpdate ? 'Hand-picked notes from NVIDIA’s release page' : 'The latest detected driver for this machine'}</p>
            </div>
            ${hasUpdate ? `<a class="card-link" href="${esc(update.detailsUrl || 'https://www.nvidia.com/en-us/drivers/')}" target="_blank" rel="noopener noreferrer">Full notes ${icon('external')}</a>` : ''}
          </div>
          ${highlights.length ? `
            <div class="highlight-list">
              ${highlights.map((item) => `
                <div class="highlight-item">${icon('check-circle')}<p>${esc(item)}</p></div>
              `).join('')}
            </div>
          ` : `
            <div class="empty-state" style="min-height:150px">
              <span class="empty-icon">${icon('check-circle')}</span>
              <h3>Nothing to install</h3>
              <p>You are on the latest release NVIDIA lists for this concept. New releases appear here automatically.</p>
            </div>
          `}
          ${fixed.length ? `
            <div class="subhead">Fixed in this release</div>
            <ul class="fixed-list">
              ${fixed.map((item) => `<li>${esc(item)}</li>`).join('')}
            </ul>
          ` : ''}
          ${hasUpdate ? `
            <div class="subhead">Before you install</div>
            <div class="install-steps">
              <div class="install-step"><b>1</b><span>Save your work and close open games.</span></div>
              <div class="install-step"><b>2</b><span>Download the official installer from NVIDIA.</span></div>
              <div class="install-step"><b>3</b><span>Run it, then reboot if the installer asks.</span></div>
            </div>
          ` : ''}
        </section>

        <aside class="card card-pad driver-details">
          <div class="card-head">
            <div>
              <h2 class="card-title">Release details</h2>
              <p class="card-sub">Checked ${esc(driver.checkedAt ? relativeTime(new Date(driver.checkedAt).getTime()) : 'just now')}</p>
            </div>
            <span class="status-pill">${esc(driver.source === 'local' ? 'LOCAL' : 'PREVIEW')}</span>
          </div>
          <div class="spec-list">
            <div class="spec-row"><span>Version</span><strong>${esc(version)}</strong></div>
            <div class="spec-row"><span>Driver type</span><strong>${esc(hasUpdate ? update.type || 'Game Ready' : 'Game Ready Driver')}</strong></div>
            <div class="spec-row"><span>Branch</span><strong>${esc(hasUpdate && update.branch ? update.branch : driver.branch || 'R620')}</strong></div>
            <div class="spec-row"><span>Released</span><strong>${esc(hasUpdate ? releaseDate(update.releaseDate) : 'Installed')}</strong></div>
            <div class="spec-row"><span>Download size</span><strong>${esc(hasUpdate ? update.sizeLabel || '—' : '—')}</strong></div>
            <div class="spec-row"><span>Signature</span><strong>WHQL</strong></div>
          </div>
          <div class="compat-card">
            <span class="compat-icon">${icon('chip')}</span>
            <div class="compat-copy">
              <strong>${esc(gpu() ? gpu().name : 'NVIDIA GPU')}</strong>
              <small>Compatible · ${esc(gpu() && gpu().vramTotalMB ? `${Math.round(gpu().vramTotalMB / 1024)} GB VRAM` : 'Windows 10 / 11')}</small>
            </div>
          </div>
          <div class="setting-row" style="margin-top:14px">
            <div class="setting-copy">
              <strong>Notify me about drivers</strong>
              <small>Show a badge when a new release is detected</small>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${state.prefs.notifications}" aria-label="Notify me about drivers" data-setting="notifications"></button>
          </div>
          <p class="driver-dl-note">
            Downloading hands off to NVIDIA's official installer in a new tab. This concept never installs a driver silently.
            ${hasUpdate ? `<a href="${esc(update.detailsUrl || 'https://www.nvidia.com/en-us/drivers/')}" target="_blank" rel="noopener noreferrer">Official release page</a>` : ''}
          </p>
        </aside>
      </div>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Games
   -------------------------------------------------------------------------- */

function recentlyPlayedCutoff() {
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

function isRecentlyPlayed(game) {
  return Boolean(game.lastPlayedMs && Number(game.lastPlayedMs) >= recentlyPlayedCutoff());
}

function filterCounts() {
  return {
    all: state.games.length,
    optimized: state.games.filter((game) => isOptimized(game.id)).length,
    recent: state.games.filter(isRecentlyPlayed).length,
  };
}

function filteredGames() {
  const query = state.search.trim().toLowerCase();
  let games = state.games.slice();

  if (state.filter === 'optimized') games = games.filter((game) => isOptimized(game.id));
  if (state.filter === 'recent') games = games.filter(isRecentlyPlayed);
  if (query) {
    games = games.filter((game) =>
      `${game.name} ${game.genre || ''}`.toLowerCase().includes(query)
    );
  }

  const sorters = {
    recent: (a, b) => (b.lastPlayedMs || 0) - (a.lastPlayedMs || 0) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => (b.sizeGB || 0) - (a.sizeGB || 0) || a.name.localeCompare(b.name),
    optimized: (a, b) =>
      Number(isOptimized(b.id)) - Number(isOptimized(a.id)) ||
      (b.lastPlayedMs || 0) - (a.lastPlayedMs || 0),
  };
  games.sort(sorters[state.sort] || sorters.recent);
  return games;
}

function renderGames() {
  const counts = filterCounts();
  const games = filteredGames();
  const scanned = state.gamesScannedAt
    ? `Scanned ${relativeTime(new Date(state.gamesScannedAt).getTime()).toLowerCase()}`
    : 'Scanning Steam library';

  return `
    <div class="page page-wide games-page">
      <div class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">Game library</span>
          <h1 class="page-title">Your library, ready to go.</h1>
          <p class="page-sub">${state.games.length} Steam ${state.games.length === 1 ? 'game' : 'games'} detected locally. Pick one, tune it, and launch straight into Steam.</p>
        </div>
        <div class="page-actions">
          <span class="status-pill ${state.gamesSource === 'steam' ? 'is-live' : ''}">${icon(state.gamesSource === 'steam' ? 'check' : 'info')} ${esc(scanned)}</span>
          <button class="btn btn-secondary" type="button" data-action="rescan-games">${icon('refresh')} Rescan</button>
        </div>
      </div>

      <div class="library-toolbar">
        <label class="search-field">
          ${icon('search')}
          <input id="game-search" type="search" value="${esc(state.search)}" placeholder="Search your library" autocomplete="off" spellcheck="false" aria-label="Search your library">
          <button class="search-clear" type="button" data-action="clear-search" aria-label="Clear search" ${state.search ? '' : 'hidden'}>${icon('close')}</button>
        </label>
        <div class="filter-chips" role="group" aria-label="Filter games">
          <button class="filter-chip${state.filter === 'all' ? ' is-active' : ''}" type="button" data-filter="all">All <span>${counts.all}</span></button>
          <button class="filter-chip${state.filter === 'optimized' ? ' is-active' : ''}" type="button" data-filter="optimized">${icon('sparkles')} Optimized <span>${counts.optimized}</span></button>
          <button class="filter-chip${state.filter === 'recent' ? ' is-active' : ''}" type="button" data-filter="recent">${icon('clock')} Recent <span>${counts.recent}</span></button>
        </div>
        <div class="library-toolbar-right">
          <div class="select-wrap">
            <select id="game-sort" aria-label="Sort games">
              <option value="recent"${state.sort === 'recent' ? ' selected' : ''}>Recently played</option>
              <option value="name"${state.sort === 'name' ? ' selected' : ''}>Name A–Z</option>
              <option value="size"${state.sort === 'size' ? ' selected' : ''}>Largest first</option>
              <option value="optimized"${state.sort === 'optimized' ? ' selected' : ''}>Optimized first</option>
            </select>
            ${icon('chevron-down')}
          </div>
        </div>
      </div>

      <p class="library-count" id="library-count">${renderLibraryCount(games.length)}</p>
      <div class="game-grid" id="game-grid">${renderGameCards(games)}</div>
      <p class="settings-footnote">${icon('info')} Library names and artwork come from your local Steam install. Launching hands off to Steam.</p>
    </div>
  `;
}

function renderLibraryCount(visible) {
  const total = state.games.length;
  if (!total) return 'No games detected yet';
  return `Showing <strong>${visible}</strong> of <strong>${total}</strong> installed games`;
}

function renderGameCards(games) {
  if (!games.length) {
    const searching = state.search.trim() || state.filter !== 'all';
    return `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">${icon(searching ? 'search' : 'gamepad')}</span>
        <h3>${searching ? 'No games match that' : 'No Steam games found'}</h3>
        <p>${searching ? 'Try a different search or clear the filters.' : 'This app reads installed games from Steam app manifests. Install a game, then rescan.'}</p>
        <button class="btn btn-secondary btn-sm" type="button" data-action="${searching ? 'clear-filters' : 'rescan-games'}">
          ${searching ? 'Clear filters' : 'Rescan library'}
        </button>
      </div>
    `;
  }

  return games.map((game, index) => renderGameCard(game, index)).join('');
}

function renderGameCard(game, index) {
  const optimized = isOptimized(game.id);
  const art = game.cover
    ? `<img class="game-cover" src="${esc(game.cover)}" alt="Cover art for ${esc(game.name)}" loading="lazy" decoding="async">`
    : `<div class="game-fallback" style="--game-accent:${esc(game.accent || '#76b900')}"><span>${esc(game.short || game.name.slice(0, 2))}</span><small>${esc(game.source || 'Steam')}</small></div>`;

  return `
    <article class="game-card" data-game-id="${esc(game.id)}" tabindex="0" role="button" aria-label="Open ${esc(game.name)}" style="animation-delay:${Math.min(index * 22, 220)}ms">
      <div class="game-art">
        ${art}
        ${optimized ? `<span class="game-status">${icon('sparkles')} Optimized</span>` : ''}
        <button class="game-play" type="button" data-play-id="${esc(game.id)}" aria-label="Play ${esc(game.name)}">${icon('play')}</button>
      </div>
      <div class="game-info">
        <strong title="${esc(game.name)}">${esc(game.name)}</strong>
        <div class="game-info-meta">
          <span>${esc((game.genre || 'Steam library').split(' · ')[0])}</span>
          <i></i>
          <span>${esc(formatSize(game.sizeGB))}</span>
          <em>${esc(relativeTime(game.lastPlayedMs))}</em>
        </div>
      </div>
    </article>
  `;
}

function updateGameResults() {
  const grid = $('#game-grid');
  if (!grid) return;
  const games = filteredGames();
  grid.innerHTML = renderGameCards(games);
  const count = $('#library-count');
  if (count) count.innerHTML = renderLibraryCount(games.length);
  $$('.filter-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === state.filter);
  });
}

function updateFilterCounts() {
  const counts = filterCounts();
  $$('.filter-chip').forEach((chip) => {
    const span = $('span', chip);
    if (!span) return;
    const key = chip.dataset.filter;
    if (key in counts) span.textContent = counts[key];
  });
}

/* --------------------------------------------------------------------------
   Game detail sheet
   -------------------------------------------------------------------------- */

function openGameSheet(id) {
  const game = getGame(id);
  if (!game) return;
  const profile = profileFor(id);
  state.selectedGameId = String(id);
  state.sheetPreset = profile ? profile.preset : 'balanced';
  state.lastFocus = document.activeElement;

  const root = $('#sheet-root');
  if (!root) return;
  root.innerHTML = renderGameSheet(game);
  const layer = $('.sheet-layer', root);
  requestAnimationFrame(() => {
    layer.classList.add('is-open');
    const close = $('.sheet-close', layer);
    if (close) setTimeout(() => close.focus({ preventScroll: true }), 60);
  });
}

function closeGameSheet() {
  const layer = $('.sheet-layer');
  if (!layer) return;
  layer.classList.remove('is-open');
  setTimeout(() => {
    if (!$('.sheet-layer.is-open')) {
      const root = $('#sheet-root');
      if (root) root.innerHTML = '';
    }
  }, 360);
  if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
    state.lastFocus.focus({ preventScroll: true });
  }
  state.selectedGameId = null;
}

function renderGameSheet(game) {
  const profile = profileFor(game.id);
  const preset = PRESETS[state.sheetPreset] || PRESETS.balanced;
  const art = game.hero || game.cover;
  const heroStyle = art
    ? `background-image:url('${esc(art)}')`
    : `background-image:linear-gradient(145deg, ${esc(game.accent || '#76b900')}55, #0c0f0f)`;
  const statusLabel = profile ? `${PRESETS[profile.preset] ? PRESETS[profile.preset].label : 'Custom'} profile` : 'No profile';

  return `
    <div class="sheet-layer">
      <button class="sheet-backdrop" type="button" data-action="close-sheet" aria-label="Close game details" tabindex="-1"></button>
      <aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
        <div class="sheet-hero" style="${heroStyle}">
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="Close game details">${icon('close')}</button>
          <div class="sheet-kicker">
            <span class="chip">${icon('gamepad')} Steam</span>
            <span class="chip">${esc((game.genre || 'Library').split(' · ')[0])}</span>
          </div>
          <h2 id="sheet-title">${esc(game.name)}</h2>
          <p>${esc(game.genre || 'Installed via Steam')} · ${esc(formatSize(game.sizeGB))} on disk</p>
          <div class="sheet-hero-actions">
            <button class="btn btn-primary" type="button" data-play-id="${esc(game.id)}">${icon('play')} Play now</button>
            <span class="status-pill sheet-status-chip">${icon(profile ? 'sparkles' : 'info')} ${esc(statusLabel)}</span>
          </div>
        </div>

        <div class="sheet-body">
          <section class="sheet-section">
            <div class="sheet-section-head">
              <h3>Optimization profile</h3>
              <span class="chip">${icon('info')} App-local</span>
            </div>
            <div class="preset-grid preset-grid-sheet" role="group" aria-label="Optimization preset">
              ${Object.values(PRESETS).map((item) => `
                <button class="preset${item.key === state.sheetPreset ? ' is-active' : ''}" type="button" data-sheet-preset="${item.key}">
                  <span class="preset-icon">${icon(item.icon)}</span>
                  <strong>${item.label}</strong>
                  <small>${item.note}</small>
                </button>
              `).join('')}
            </div>
            <div class="game-detail-list" id="sheet-preset-settings" style="margin-top:12px">
              ${renderPresetRows(preset)}
            </div>
            <div class="sheet-actions">
              <button class="btn btn-primary btn-sm" type="button" data-action="save-profile">${icon('check')} ${profile ? 'Update profile' : 'Save profile'}</button>
              ${profile ? `<button class="btn btn-secondary btn-sm" type="button" data-action="remove-profile">Remove</button>` : ''}
            </div>
            <p class="data-note" style="margin-top:12px;padding-top:0;border-top:0">${icon('info')} Presets are stored in this app only. They do not edit game config files or promise real FPS gains.</p>
          </section>

          <section class="sheet-section">
            <div class="sheet-section-head"><h3>Session overlay</h3></div>
            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Performance overlay</strong>
                  <small>Corner readout for FPS, temps, and load</small>
                </div>
                <div class="setting-control">
                  <kbd>${esc(state.prefs.overlayHotkey)}</kbd>
                  <button class="switch" type="button" role="switch" aria-checked="${state.prefs.overlay}" aria-label="Performance overlay" data-setting="overlay"></button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Launch through Steam</strong>
                  <small>Uses Steam's official game launch link</small>
                </div>
                <span class="status-pill is-live">${icon('check')} Ready</span>
              </div>
            </div>
          </section>

          <section class="sheet-section">
            <div class="sheet-section-head"><h3>Game details</h3></div>
            <div class="game-detail-list">
              <div class="game-detail-row"><span>Genre</span><strong>${esc(game.genre || 'Steam library')}</strong></div>
              <div class="game-detail-row"><span>Install size</span><strong>${esc(formatSize(game.sizeGB))}</strong></div>
              <div class="game-detail-row"><span>Last played</span><strong>${esc(relativeTime(game.lastPlayedMs))}</strong></div>
              <div class="game-detail-row"><span>Steam App ID</span><strong>${esc(game.appid || game.id)}</strong></div>
              <div class="game-detail-row"><span>Source</span><strong>Steam app manifest</strong></div>
            </div>
          </section>
        </div>

        <div class="sheet-footer">
          <button class="btn btn-primary" type="button" data-play-id="${esc(game.id)}">${icon('play')} Play now</button>
          <button class="btn btn-secondary" type="button" data-action="close-sheet">Close</button>
        </div>
      </aside>
    </div>
  `;
}

function renderPresetRows(preset) {
  return Object.entries(preset.settings).map(([key, value]) => `
    <div class="game-detail-row"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>
  `).join('');
}

function updateSheetPreset(presetKey) {
  if (!PRESETS[presetKey]) return;
  state.sheetPreset = presetKey;
  $$('.preset[data-sheet-preset]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.sheetPreset === presetKey);
  });
  const list = $('#sheet-preset-settings');
  if (list) list.innerHTML = renderPresetRows(PRESETS[presetKey]);
}

function saveSelectedProfile() {
  const id = state.selectedGameId;
  const game = getGame(id);
  if (!game) return;
  setProfilePreset(id, state.sheetPreset);
  const chip = $('.sheet-status-chip');
  if (chip) chip.innerHTML = `${icon('sparkles')} ${esc(PRESETS[state.sheetPreset].label)} profile`;
  const save = $('[data-action="save-profile"]');
  if (save) save.innerHTML = `${icon('check')} Profile saved`;
  updateFilterCounts();
  updateGameResults();
  toast('Profile saved locally', `${game.name} now uses the ${PRESETS[state.sheetPreset].label} preset inside this app.`, 'success');
}

function removeSelectedProfile() {
  const id = state.selectedGameId;
  const game = getGame(id);
  if (!game || !state.profiles) return;
  delete state.profiles[String(id)];
  saveJSON(STORAGE.profiles, state.profiles);
  const chip = $('.sheet-status-chip');
  if (chip) chip.innerHTML = `${icon('info')} No profile`;
  const remove = $('[data-action="remove-profile"]');
  if (remove) remove.remove();
  const save = $('[data-action="save-profile"]');
  if (save) save.innerHTML = `${icon('check')} Save profile`;
  updateFilterCounts();
  updateGameResults();
  toast('Profile removed', `${game.name} no longer has an app-local profile.`, 'info');
}

async function launchGame(id) {
  const game = getGame(id);
  if (!game) return;
  try {
    const result = await fetchJSON(`/api/games/${encodeURIComponent(id)}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!result.ok) throw new Error(result.error || 'Steam did not accept the launch.');
    toast('Launching through Steam', `${game.name} is opening. Have a good session.`, 'success');
  } catch (error) {
    toast('Could not launch game', error.message || 'Steam may not be running.', 'error');
  }
}

/* --------------------------------------------------------------------------
   Performance
   -------------------------------------------------------------------------- */

function metricCard({ label, iconName, value, unit, footLeft, footRight, spark, id }) {
  return `
    <article class="stat-card metric-card">
      <div class="stat-top">
        <span class="stat-label">${icon(iconName)} ${label}</span>
        <span class="stat-delta">${footRight || ''}</span>
      </div>
      <div class="stat-value" id="${id}">${value}${unit ? `<small>${unit}</small>` : ''}</div>
      <canvas class="metric-spark" data-spark="${spark}" width="220" height="34" aria-hidden="true"></canvas>
      <div class="stat-foot"><span>${footLeft || ''}</span><span>${isLive() ? 'Live' : 'Demo'}</span></div>
    </article>
  `;
}

function renderPerformance() {
  const device = gpu();
  const system = systemInfo();
  const load = num(device && device.utilization);
  const temp = num(device && device.temperature);
  const vramPercent = num(device && device.vramPercent);
  const powerPercent = num(device && device.powerPercent);
  const fan = num(device && device.fan);
  const clock = num(device && device.clock);
  const power = num(device && device.powerDraw);
  const powerLimit = num(device && device.powerLimit);
  const vramUsed = num(device && device.vramUsedMB);
  const vramTotal = num(device && device.vramTotalMB);

  return `
    <div class="page perf-page">
      <div class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">Performance</span>
          <h1 class="page-title">Your GPU, in real time.</h1>
          <p class="page-sub">Direct local reads from nvidia-smi. Nothing leaves this machine, and nothing is estimated.</p>
        </div>
        <div class="page-actions">
          <span class="status-pill ${state.live ? 'is-live' : ''}">${icon(state.live ? 'activity' : 'clock')} ${state.live ? 'Live · 2s' : 'Paused'}</span>
          <button class="btn btn-secondary" type="button" data-action="toggle-live">${icon(state.live ? 'clock' : 'refresh')} ${state.live ? 'Pause' : 'Resume'}</button>
        </div>
      </div>

      <div class="perf-top">
        <section class="perf-gauge-card card">
          <div class="perf-gauge-head">
            <h3>GPU utilization</h3>
            <span class="status-pill ${isLive() ? 'is-live' : ''}">${esc(dataSourceLabel())}</span>
          </div>
          <div class="gauge" id="perf-gauge" style="--value:${load == null ? 0 : clamp(load, 0, 100)}" role="img" aria-label="GPU utilization ${load == null ? 'unavailable' : Math.round(load) + ' percent'}">
            <div class="gauge-center">
              <strong><span id="perf-load-value">${load == null ? '—' : Math.round(load)}</span><small>%</small></strong>
              <span>Load</span>
            </div>
          </div>
          <div class="gauge-foot">
            <div class="gauge-foot-item"><strong id="perf-clock">${clock == null ? '—' : `${Math.round(clock)} MHz`}</strong><span>Core clock</span></div>
            <div class="gauge-foot-item"><strong id="perf-fan">${fan == null || fan === 0 ? 'Idle' : `${Math.round(fan)}%`}</strong><span>Fan speed</span></div>
          </div>
        </section>

        <section class="chart-card card">
          <div class="chart-head">
            <div>
              <h3>Session activity</h3>
              <p>Rolling samples collected by this app</p>
            </div>
            <div class="chart-legend">
              <span><i></i> Load</span>
              <span><i class="legend-temp"></i> Temp</span>
              <span><i class="legend-power"></i> Power</span>
            </div>
          </div>
          <div class="chart-wrap"><canvas id="perf-chart" aria-label="Live GPU activity chart"></canvas></div>
          <div class="chart-axis"><span>Earlier in session</span><span>Now</span></div>
        </section>
      </div>

      <div class="metric-grid">
        ${metricCard({
          label: 'GPU load',
          iconName: 'gauge',
          value: load == null ? '—' : Math.round(load),
          unit: '%',
          footLeft: device && device.pstate ? `Power state ${device.pstate}` : 'Realtime',
          footRight: 'Now',
          spark: 'utilization',
          id: 'perf-load',
        })}
        ${metricCard({
          label: 'Temperature',
          iconName: 'thermometer',
          value: temp == null ? '—' : Math.round(temp),
          unit: '°C',
          footLeft: fan == null || fan === 0 ? 'Zero-fan mode' : `Fan ${Math.round(fan)}%`,
          footRight: 'Sensor',
          spark: 'temperature',
          id: 'perf-temp',
        })}
        ${metricCard({
          label: 'VRAM used',
          iconName: 'memory',
          value: vramUsed == null ? '—' : display1(vramUsed / 1024),
          unit: 'GB',
          footLeft: vramTotal == null ? '—' : `${Math.round(vramTotal / 1024)} GB total`,
          footRight: vramPercent == null ? '' : `${Math.round(vramPercent)}%`,
          spark: 'vramPercent',
          id: 'perf-vram',
        })}
        ${metricCard({
          label: 'Board power',
          iconName: 'zap',
          value: power == null ? '—' : Math.round(power),
          unit: 'W',
          footLeft: powerLimit == null ? '—' : `${Math.round(powerLimit)} W limit`,
          footRight: powerPercent == null ? '' : `${Math.round(powerPercent)}%`,
          spark: 'powerPercent',
          id: 'perf-power',
        })}
      </div>

      <div class="perf-bottom">
        <section class="card card-pad overlay-card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Performance overlay</h2>
              <p class="card-sub">A compact HUD for the corner of your screen</p>
            </div>
            <span class="status-pill ${state.prefs.overlay ? 'is-live' : ''}">${state.prefs.overlay ? 'ON' : 'OFF'}</span>
          </div>
          <div class="overlay-preview">
            <div class="overlay-preview-copy">
              <strong>FPS · GPU · TEMP</strong>
              <small>Corner readout preview</small>
            </div>
            <kbd>${esc(state.prefs.overlayHotkey)}</kbd>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>Enable overlay</strong>
              <small>App-local setting and preview</small>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${state.prefs.overlay}" aria-label="Enable performance overlay" data-setting="overlay"></button>
          </div>
        </section>

        <section class="card card-pad gpu-spec-card">
          <div class="gpu-spec-name">
            <span class="gpu-spec-icon">${icon('chip')}</span>
            <div>
              <strong>${esc(device ? device.name : 'NVIDIA GPU')}</strong>
              <small>${esc(device && device.driver ? `Driver ${device.driver}` : 'Driver unavailable')}</small>
            </div>
          </div>
          <div class="spec-list">
            <div class="spec-row"><span>VRAM</span><strong>${vramTotal == null ? '—' : `${Math.round(vramTotal / 1024)} GB GDDR6`}</strong></div>
            <div class="spec-row"><span>Power limit</span><strong>${powerLimit == null ? '—' : `${Math.round(powerLimit)} W`}</strong></div>
            <div class="spec-row"><span>Memory clock</span><strong>${num(device && device.memClock) == null ? '—' : `${Math.round(device.memClock)} MHz`}</strong></div>
            <div class="spec-row"><span>Power state</span><strong>${esc(device && device.pstate ? device.pstate : '—')}</strong></div>
            <div class="spec-row"><span>Source</span><strong>nvidia-smi</strong></div>
          </div>
        </section>

        <section class="card card-pad system-card">
          <div class="card-head">
            <div>
              <h2 class="card-title">This machine</h2>
              <p class="card-sub">Local system details</p>
            </div>
            <span class="status-pill">${esc((system && system.arch) || 'SYSTEM')}</span>
          </div>
          <div class="spec-list">
            <div class="spec-row"><span>Computer</span><strong>${esc((system && system.hostname) || '—')}</strong></div>
            <div class="spec-row"><span>CPU</span><strong title="${esc((system && system.cpu) || '')}">${esc(shortCpu((system && system.cpu) || '—'))}</strong></div>
            <div class="spec-row"><span>Cores</span><strong>${system && system.cpuCores ? system.cpuCores : '—'}</strong></div>
            <div class="spec-row"><span>Memory</span><strong>${system && system.ramGB ? `${system.ramGB} GB` : '—'}</strong></div>
            <div class="spec-row"><span>OS</span><strong>${esc(shortOs(system))}</strong></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function shortCpu(cpu) {
  return String(cpu || '—')
    .replace(/\s+\d+-Core Processor.*$/i, '')
    .replace(/\(R\)|\(TM\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortOs(system) {
  if (!system) return '—';
  const platform = system.platform === 'win32' ? 'Windows' : system.platform;
  return `${platform} ${system.arch || ''}`.trim();
}

function sparkValues(key) {
  return state.history
    .map((sample) => num(sample[key]))
    .filter((value) => value != null);
}

function drawSparks() {
  const colors = {
    utilization: '#a7f21c',
    temperature: '#f3ba43',
    vramPercent: '#8ad16a',
    powerPercent: '#61a8ff',
  };
  $$('.metric-spark').forEach((canvas) => {
    const key = canvas.dataset.spark;
    drawSpark(canvas, sparkValues(key).slice(-40), colors[key] || '#a7f21c');
  });
}

function drawSpark(canvas, values, color) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (values.length < 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, rect.height - 6);
    ctx.lineTo(rect.width, rect.height - 6);
    ctx.stroke();
    return;
  }

  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 4);
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * (rect.width - 2) + 1,
    y: pad + (1 - (value - min) / range) * (rect.height - pad * 2),
  }));

  ctx.beginPath();
  traceSmooth(ctx, points);
  ctx.lineTo(rect.width, rect.height);
  ctx.lineTo(0, rect.height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
  gradient.addColorStop(0, hexToRgba(color, 0.18));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  traceSmooth(ctx, points);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.globalAlpha = 1;

  const end = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(end.x - 1, end.y, 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function traceSmooth(ctx, points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function hexToRgba(hex, alpha) {
  const cleaned = String(hex || '#a7f21c').replace('#', '');
  const full = cleaned.length === 3 ? cleaned.split('').map((char) => char + char).join('') : cleaned;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawPerfChart() {
  const canvas = $('#perf-chart');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = { top: 12, right: 8, bottom: 10, left: 30 };
  const plotW = rect.width - pad.left - pad.right;
  const plotH = rect.height - pad.top - pad.bottom;
  const samples = state.history.slice(-90);

  ctx.font = '8px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(rect.width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,158,145,0.6)';
    ctx.fillText(String(100 - i * 25), pad.left - 7, y);
  }

  if (samples.length < 2) {
    ctx.fillStyle = 'rgba(183,192,180,0.6)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Collecting live samples…', pad.left + plotW / 2, pad.top + plotH / 2);
    if (samples.length === 1) {
      const value = num(samples[0].utilization);
      if (value != null) {
        const y = pad.top + (1 - clamp(value, 0, 100) / 100) * plotH;
        ctx.beginPath();
        ctx.arc(pad.left + plotW, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#a7f21c';
        ctx.fill();
      }
    }
    return;
  }

  const series = [
    { key: 'utilization', color: '#a7f21c', width: 2, fill: true },
    { key: 'temperature', color: '#f3ba43', width: 1.4, fill: false },
    { key: 'powerPercent', color: '#61a8ff', width: 1.4, fill: false },
  ];

  for (const item of series) {
    const points = [];
    samples.forEach((sample, index) => {
      const value = num(sample[item.key]);
      if (value == null) return;
      points.push({
        x: pad.left + (index / (samples.length - 1)) * plotW,
        y: pad.top + (1 - clamp(value, 0, 100) / 100) * plotH,
      });
    });
    if (points.length < 2) continue;

    if (item.fill) {
      ctx.beginPath();
      traceSmooth(ctx, points);
      ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
      ctx.lineTo(points[0].x, pad.top + plotH);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
      gradient.addColorStop(0, 'rgba(167,242,28,0.20)');
      gradient.addColorStop(1, 'rgba(167,242,28,0)');
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    traceSmooth(ctx, points);
    ctx.strokeStyle = item.color;
    ctx.globalAlpha = item.fill ? 1 : 0.85;
    ctx.lineWidth = item.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (item.fill) {
      const end = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = item.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(167,242,28,0.15)';
      ctx.fill();
    }
  }
}

function toggleLive() {
  state.live = !state.live;
  renderRoute({ scroll: false });
  toast(
    state.live ? 'Live telemetry resumed' : 'Live telemetry paused',
    state.live ? 'The dashboard is polling nvidia-smi again.' : 'The last samples stay on screen.',
    'info'
  );
}

/* --------------------------------------------------------------------------
   Settings
   -------------------------------------------------------------------------- */

function rowSwitch(key, label, help) {
  return `
    <div class="setting-row">
      <div class="setting-copy"><strong>${label}</strong><small>${help}</small></div>
      <button class="switch" type="button" role="switch" aria-checked="${Boolean(state.prefs[key])}" aria-label="${label}" data-setting="${key}"></button>
    </div>
  `;
}

function renderSettings() {
  const system = systemInfo();
  const device = gpu();
  return `
    <div class="page settings-page">
      <div class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">Preferences</span>
          <h1 class="page-title">Make it yours.</h1>
          <p class="page-sub">A short list of settings, stored locally in this browser. No account needed.</p>
        </div>
        <div class="page-actions">
          <span class="status-pill">${icon('shield')} Local only</span>
        </div>
      </div>

      <div class="settings-grid">
        <div class="settings-col">
          <section class="card settings-section">
            <div class="card-head">
              <div class="settings-section-head">
                <span class="section-icon">${icon('refresh')}</span>
                <div><h2>Driver updates</h2><p class="card-sub">Keep the important badge useful</p></div>
              </div>
            </div>
            <div class="settings-list">
              ${rowSwitch('autoCheck', 'Check automatically', 'Compare installed and latest on launch')}
              ${rowSwitch('notifications', 'Show update badge', 'Display a dot in the sidebar and top bar')}
            </div>
          </section>

          <section class="card settings-section">
            <div class="card-head">
              <div class="settings-section-head">
                <span class="section-icon">${icon('overlay')}</span>
                <div><h2>Overlay & motion</h2><p class="card-sub">Keep the interface calm or compact</p></div>
              </div>
            </div>
            <div class="settings-list">
              ${rowSwitch('overlay', 'Performance overlay', 'Show the overlay setting across the app')}
              <div class="setting-row">
                <div class="setting-copy"><strong>Overlay shortcut</strong><small>Displayed on the performance page</small></div>
                <div class="setting-control"><kbd>${esc(state.prefs.overlayHotkey)}</kbd></div>
              </div>
              ${rowSwitch('reducedMotion', 'Reduce motion', 'Disable page, card, and orbit animation')}
            </div>
          </section>

          <section class="card settings-section">
            <div class="card-head">
              <div class="settings-section-head">
                <span class="section-icon">${icon('monitor')}</span>
                <div><h2>App behavior</h2><p class="card-sub">Small conveniences for this concept</p></div>
              </div>
            </div>
            <div class="settings-list">
              ${rowSwitch('launchAtStartup', 'Launch at startup', 'Preference only; no startup entry is created')}
              <div class="setting-row">
                <div class="setting-copy"><strong>Telemetry source</strong><small>Read locally with nvidia-smi</small></div>
                <span class="status-pill ${isLive() ? 'is-live' : ''}">${icon(isLive() ? 'check' : 'info')} ${esc(dataSourceLabel())}</span>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><strong>Game library</strong><small>${state.games.length} games found in Steam manifests</small></div>
                <button class="btn btn-secondary btn-sm" type="button" data-action="rescan-games">${icon('refresh')} Rescan</button>
              </div>
            </div>
            <p class="settings-footnote">${icon('info')} All preferences live in localStorage on this browser.</p>
          </section>
        </div>

        <div class="settings-col">
          <section class="card about-card">
            <div class="about-brand">
              <span class="about-mark">${icon('spark')}</span>
              <div><strong>NVIDIA App</strong><small>Reimagined · concept build</small></div>
            </div>
            <p>A smaller, faster take on the NVIDIA App: live GPU telemetry, a clear driver handoff, and a library that respects your time.</p>
            <div class="about-tags">
              <span class="chip">${icon('activity')} Live nvidia-smi</span>
              <span class="chip">${icon('gamepad')} Steam library</span>
              <span class="chip">${icon('shield')} Local-first</span>
              <span class="chip">${icon('sparkles')} REA-guided</span>
            </div>
            <div class="about-links">
              <a class="about-link" href="https://www.nvidia.com/en-us/software/nvidia-app/" target="_blank" rel="noopener noreferrer">${icon('external')} NVIDIA App <span class="link-arrow">${icon('arrow-up-right')}</span></a>
              <a class="about-link" href="https://www.nvidia.com/en-us/drivers/" target="_blank" rel="noopener noreferrer">${icon('download')} Official drivers <span class="link-arrow">${icon('arrow-up-right')}</span></a>
              <button class="about-link" type="button" data-action="copy-system">${icon('copy')} Copy system summary <span class="link-arrow">${icon('copy')}</span></button>
            </div>
            <div class="data-note">${icon('info')} Concept UI. Not affiliated with NVIDIA. Driver installation always opens NVIDIA's official installer.</div>
          </section>

          <section class="card settings-section danger-zone">
            <div class="card-head">
              <div class="settings-section-head">
                <span class="section-icon">${icon('trash')}</span>
                <div><h2>Reset preferences</h2><p class="card-sub">Clear toggles and saved game profiles</p></div>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" type="button" data-action="reset-prefs">${icon('trash')} Reset this app</button>
            <p class="settings-footnote">${icon('info')} Steam games, game files, and drivers are never touched.</p>
          </section>

          <section class="card settings-section">
            <div class="card-head">
              <div class="settings-section-head">
                <span class="section-icon">${icon('monitor')}</span>
                <div><h2>Detected system</h2><p class="card-sub">Read-only</p></div>
              </div>
            </div>
            <div class="spec-list">
              <div class="spec-row"><span>GPU</span><strong title="${esc(device ? device.name : '')}">${esc(shortCpu(device ? gpuShortName(device.name) : '—'))}</strong></div>
              <div class="spec-row"><span>Driver</span><strong>${esc(device && device.driver ? device.driver : '—')}</strong></div>
              <div class="spec-row"><span>Computer</span><strong>${esc(system && system.hostname ? system.hostname : '—')}</strong></div>
              <div class="spec-row"><span>Platform</span><strong>${esc(shortOs(system))}</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Live telemetry
   -------------------------------------------------------------------------- */

function setHTML(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function setMeter(id, value) {
  const node = document.getElementById(id);
  if (node) node.style.width = `${value == null ? 0 : clamp(value, 0, 100)}%`;
}

function applyLiveSystem(system) {
  if (!system || !system.ok) return;
  state.system = system;
  pushMetric(metricFromSystem(system));
  renderSidebarGpu();

  const device = system.gpu || {};
  const load = num(device.utilization);
  const temp = num(device.temperature);
  const fan = num(device.fan);
  const vramUsed = num(device.vramUsedMB);
  const vramTotal = num(device.vramTotalMB);
  const power = num(device.powerDraw);
  const powerLimit = num(device.powerLimit);
  const clock = num(device.clock);

  setHTML('live-util', `${load == null ? '—' : Math.round(load)}<small>%</small>`);
  setMeter('live-util-meter', load);
  setText('live-util-foot', clock == null ? 'Clock unavailable' : `${Math.round(clock)} MHz`);

  setHTML('live-temp', `${temp == null ? '—' : Math.round(temp)}<small>°C</small>`);
  setMeter('live-temp-meter', temp == null ? null : (temp / 90) * 100);
  setText('live-temp-foot', fan == null || fan === 0 ? 'Fan idle' : `Fan ${Math.round(fan)}%`);

  setHTML('live-vram', `${vramUsed == null ? '—' : display1(vramUsed / 1024)}<small>GB</small>`);
  setMeter('live-vram-meter', device.vramPercent);
  setText('live-vram-foot', vramTotal == null ? 'Total unavailable' : `${Math.round(vramTotal / 1024)} GB total`);

  setHTML('live-power', `${power == null ? '—' : Math.round(power)}<small>W</small>`);
  setMeter('live-power-meter', device.powerPercent);
  setText('live-power-foot', powerLimit == null ? 'Limit unavailable' : `${Math.round(powerLimit)} W limit`);

  const gauge = $('#perf-gauge');
  if (gauge) gauge.style.setProperty('--value', load == null ? 0 : clamp(load, 0, 100));
  setText('perf-load-value', load == null ? '—' : String(Math.round(load)));
  setText('perf-clock', clock == null ? '—' : `${Math.round(clock)} MHz`);
  setText('perf-fan', fan == null || fan === 0 ? 'Idle' : `${Math.round(fan)}%`);
  setHTML('perf-load', `${load == null ? '—' : Math.round(load)}<small>%</small>`);
  setHTML('perf-temp', `${temp == null ? '—' : Math.round(temp)}<small>°C</small>`);
  setHTML('perf-vram', `${vramUsed == null ? '—' : display1(vramUsed / 1024)}<small>GB</small>`);
  setHTML('perf-power', `${power == null ? '—' : Math.round(power)}<small>W</small>`);

  if (state.route === 'performance') {
    drawPerfChart();
    drawSparks();
  }
}

async function refreshSystem() {
  if (!state.live || document.visibilityState === 'hidden') return;
  try {
    const system = await fetchJSON('/api/system');
    applyLiveSystem(system);
  } catch {
    // A single missed sample is not worth interrupting the user.
  }
}

function startPolling() {
  setInterval(refreshSystem, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshSystem();
  });
}

async function hydrate() {
  const results = await Promise.allSettled([
    fetchJSON('/api/system'),
    fetchJSON('/api/driver'),
    fetchJSON('/api/games'),
    fetchJSON('/api/history'),
  ]);

  const [systemResult, driverResult, gamesResult, historyResult] = results;

  if (systemResult.status === 'fulfilled' && systemResult.value && systemResult.value.ok) {
    state.system = systemResult.value;
    pushMetric(metricFromSystem(systemResult.value));
  }

  if (driverResult.status === 'fulfilled' && driverResult.value) {
    state.driver = driverResult.value;
  } else if (state.system) {
    state.driver = {
      installed: state.system.gpu.driver || '—',
      latest: state.system.gpu.driver || '—',
      branch: null,
      updateAvailable: false,
      update: null,
      source: state.system.source,
      checkedAt: new Date().toISOString(),
    };
  }

  if (gamesResult.status === 'fulfilled' && gamesResult.value && gamesResult.value.ok) {
    state.games = Array.isArray(gamesResult.value.games) ? gamesResult.value.games : [];
    state.gamesSource = gamesResult.value.source || 'steam';
    state.gamesScannedAt = gamesResult.value.scannedAt || new Date().toISOString();
  } else {
    state.gamesSource = 'error';
  }

  if (historyResult.status === 'fulfilled' && historyResult.value && Array.isArray(historyResult.value.samples)) {
    seedHistory(historyResult.value.samples);
  }

  seedProfilesIfNeeded();
  state.booted = true;
  renderRoute();

  if (!state.system) {
    toast('Telemetry unavailable', 'The app is running with placeholder metrics. Check that nvidia-smi is installed.', 'error', 6000);
  }
  if (state.gamesSource === 'error') {
    toast('Steam library unavailable', 'No local Steam manifests could be read. The rest of the app still works.', 'info', 5000);
  }
}

/* --------------------------------------------------------------------------
   Driver actions
   -------------------------------------------------------------------------- */

async function checkDrivers() {
  if (state.driverChecking) return;
  state.driverChecking = true;
  renderRoute({ scroll: false });
  try {
    const driver = await fetchJSON('/api/driver?check=1');
    state.driver = driver;
    toast(
      driver.updateAvailable ? 'A new driver is ready' : 'You are up to date',
      driver.updateAvailable
        ? `Version ${driver.latest} is available for ${gpuShortName(driver.gpu || 'your GPU')}.`
        : `Version ${driver.installed} is the latest release detected.`,
      driver.updateAvailable ? 'info' : 'success',
      5200
    );
  } catch (error) {
    toast('Driver check failed', error.message || 'Could not reach the local driver service.', 'error');
  } finally {
    state.driverChecking = false;
    renderRoute({ scroll: false });
  }
}

function openDriverModal() {
  const driver = state.driver;
  if (!driver) return;
  const update = driver.update;
  if (!update) {
    mountModal(`
      <div class="modal-layer">
        <div class="modal-backdrop" data-action="close-modal"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <span class="modal-icon">${icon('check-circle')}</span>
            <div class="modal-head-copy">
              <h2 id="modal-title">You're on the latest driver</h2>
              <p>Version ${esc(driver.installed)} is the newest release detected for this machine.</p>
            </div>
            <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">${icon('close')}</button>
          </div>
          <div class="modal-body">
            <div class="modal-option-list">
              <a class="modal-option" href="https://www.nvidia.com/en-us/drivers/" target="_blank" rel="noopener noreferrer">
                <span class="modal-option-icon">${icon('external')}</span>
                <span class="modal-option-copy"><strong>Browse NVIDIA drivers</strong><small>Official driver archive on nvidia.com</small></span>
                ${icon('arrow-up-right', 'link-arrow')}
              </a>
              <button class="modal-option" type="button" data-route="performance">
                <span class="modal-option-icon">${icon('activity')}</span>
                <span class="modal-option-copy"><strong>View live performance</strong><small>Check temperatures, load, and power</small></span>
                ${icon('arrow-right', 'link-arrow')}
              </button>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" type="button" data-action="close-modal">Close</button>
          </div>
        </div>
      </div>
    `);
    return;
  }

  mountModal(`
    <div class="modal-layer">
      <div class="modal-backdrop" data-action="close-modal"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <span class="modal-icon">${icon('download')}</span>
          <div class="modal-head-copy">
            <h2 id="modal-title">Download Game Ready Driver ${esc(update.version)}</h2>
            <p>This hands off to NVIDIA's official installer. Nothing installs automatically.</p>
          </div>
          <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">${icon('close')}</button>
        </div>
        <div class="modal-body">
          <div class="driver-modal-versions">
            <div><span>Installed</span><strong>${esc(driver.installed)}</strong></div>
            <span class="arrow">${icon('arrow-right')}</span>
            <div><span>Available</span><strong>${esc(update.version)}</strong></div>
          </div>
          ${Array.isArray(update.highlights) && update.highlights.length ? `
            <div class="highlight-list">
              ${update.highlights.slice(0, 3).map((item) => `<div class="highlight-item">${icon('check-circle')}<p>${esc(item)}</p></div>`).join('')}
            </div>
          ` : ''}
          <div class="modal-note">${icon('info')} Save your work and close games before running the installer. The download is about ${esc(update.sizeLabel || 'one gigabyte')}.</div>
          <div class="copy-row">
            <code>${esc(update.downloadUrl)}</code>
            <button class="btn btn-secondary btn-sm" type="button" data-action="copy-driver-link">${icon('copy')} Copy</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" type="button" data-action="close-modal">Not now</button>
          <a class="btn btn-primary" href="${esc(update.downloadUrl)}" target="_blank" rel="noopener noreferrer" data-driver-download>${icon('download')} Download installer</a>
        </div>
      </div>
    </div>
  `);
}

/* --------------------------------------------------------------------------
   Modal helpers
   -------------------------------------------------------------------------- */

function mountModal(html) {
  const root = $('#modal-root');
  if (!root) return;
  state.lastFocus = document.activeElement;
  root.innerHTML = html;
  const layer = $('.modal-layer', root);
  requestAnimationFrame(() => {
    layer.classList.add('is-open');
    const focusTarget = $('.modal-close', layer) || $('.modal .btn-primary', layer);
    if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 50);
  });
}

function closeModal() {
  const layer = $('.modal-layer');
  if (!layer) return;
  layer.classList.remove('is-open');
  setTimeout(() => {
    const root = $('#modal-root');
    if (root && !$('.modal-layer.is-open')) root.innerHTML = '';
  }, 260);
  if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
    state.lastFocus.focus({ preventScroll: true });
  }
}

function openConfirm({ title, description, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  state.confirmAction = onConfirm;
  mountModal(`
    <div class="modal-layer">
      <div class="modal-backdrop" data-action="close-modal"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <span class="modal-icon">${icon(danger ? 'trash' : 'info')}</span>
          <div class="modal-head-copy"><h2 id="modal-title">${esc(title)}</h2><p>${esc(description)}</p></div>
          <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">${icon('close')}</button>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-action="run-confirm">${esc(confirmLabel)}</button>
        </div>
      </div>
    </div>
  `);
}

function runConfirm() {
  const action = state.confirmAction;
  state.confirmAction = null;
  closeModal();
  if (typeof action === 'function') setTimeout(action, 80);
}

function openResetConfirm() {
  openConfirm({
    title: 'Reset this app?',
    description: 'This clears preferences, toggles, and saved game profiles from this browser. Steam games, game files, and drivers are not touched.',
    confirmLabel: 'Reset preferences',
    danger: true,
    onConfirm: () => {
      state.prefs = { ...DEFAULT_PREFS };
      state.profiles = {};
      saveJSON(STORAGE.prefs, state.prefs);
      saveJSON(STORAGE.profiles, state.profiles);
      applyPreferences();
      state.homePreset = 'balanced';
      state.filter = 'all';
      state.search = '';
      renderRoute({ scroll: false });
      toast('Preferences reset', 'The app is back to its original defaults.', 'info');
    },
  });
}

/* --------------------------------------------------------------------------
   Data actions
   -------------------------------------------------------------------------- */

async function rescanGames() {
  try {
    const data = await fetchJSON('/api/games?refresh=1');
    state.games = Array.isArray(data.games) ? data.games : [];
    state.gamesSource = data.source || 'steam';
    state.gamesScannedAt = data.scannedAt || new Date().toISOString();
    if (state.profiles === null) seedProfilesIfNeeded();
    if (state.route === 'games') updateGameResults();
    else renderRoute({ scroll: false });
    updateChrome();
    toast('Library rescanned', `${state.games.length} installed Steam ${state.games.length === 1 ? 'game' : 'games'} found.`, 'success');
  } catch (error) {
    toast('Scan failed', error.message || 'Could not read the Steam library.', 'error');
  }
}

function copyText(text, successMessage = 'Copied to clipboard') {
  const done = () => toast('Copied', successMessage, 'success', 2600);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    toast('Copy failed', 'Your browser blocked clipboard access.', 'error');
  }
  area.remove();
}

function copySystem() {
  const device = gpu();
  const system = systemInfo();
  const lines = [
    'NVIDIA App — Reimagined (concept build)',
    `GPU: ${device ? device.name : 'Unavailable'}`,
    `Driver: ${state.driver ? state.driver.installed : 'Unavailable'}`,
    `VRAM: ${device && device.vramTotalMB ? `${Math.round(device.vramTotalMB / 1024)} GB` : 'Unavailable'}`,
    `CPU: ${system ? system.cpu : 'Unavailable'}`,
    `Memory: ${system ? `${system.ramGB} GB` : 'Unavailable'}`,
    `OS: ${system ? `${system.os} (${system.arch})` : 'Unavailable'}`,
    `Telemetry: ${dataSourceLabel()}`,
  ];
  copyText(lines.join('\n'), 'System summary copied.');
}

function copyDriverLink() {
  const update = state.driver && state.driver.update;
  if (!update || !update.downloadUrl) return;
  copyText(update.downloadUrl, 'Official installer link copied.');
}

/* --------------------------------------------------------------------------
   Command palette
   -------------------------------------------------------------------------- */

function commandItems() {
  const items = [
    { command: 'nav:home', group: 'Navigate', title: 'Home', sub: 'Live overview and recent games', iconName: 'home' },
    { command: 'nav:drivers', group: 'Navigate', title: 'Drivers', sub: state.driver && state.driver.updateAvailable ? `Update ${state.driver.latest} available` : 'Driver status and release notes', iconName: 'download' },
    { command: 'nav:games', group: 'Navigate', title: 'Games', sub: `${state.games.length} Steam games detected`, iconName: 'gamepad' },
    { command: 'nav:performance', group: 'Navigate', title: 'Performance', sub: 'Live GPU telemetry and history', iconName: 'activity' },
    { command: 'nav:settings', group: 'Navigate', title: 'Settings', sub: 'Preferences and app details', iconName: 'settings' },
    { command: 'action:check-drivers', group: 'Actions', title: 'Check for driver updates', sub: 'Compare installed and latest', iconName: 'refresh' },
    { command: 'action:rescan-games', group: 'Actions', title: 'Rescan Steam library', sub: 'Refresh local game manifests', iconName: 'refresh' },
    { command: 'action:toggle-overlay', group: 'Actions', title: `${state.prefs.overlay ? 'Disable' : 'Enable'} performance overlay`, sub: 'App-local preference', iconName: 'overlay' },
  ];
  if (state.driver && state.driver.updateAvailable) {
    items.push({ command: 'action:driver-download', group: 'Actions', title: 'Download latest driver', sub: `Version ${state.driver.latest} from NVIDIA`, iconName: 'download' });
  }
  const games = state.games.filter((game) => !state.paletteQuery || game.name.toLowerCase().includes(state.paletteQuery.toLowerCase()));
  for (const game of games.slice(0, 10)) {
    items.push({
      command: `game:${game.id}`,
      group: 'Games',
      title: game.name,
      sub: `${game.genre || 'Steam'} · ${formatSize(game.sizeGB)}`,
      iconName: 'play',
    });
  }
  return items;
}

function filterPaletteItems() {
  const query = state.paletteQuery.trim().toLowerCase();
  if (!query) return commandItems();
  return commandItems().filter((item) =>
    `${item.title} ${item.sub} ${item.group}`.toLowerCase().includes(query)
  );
}

function optionAvatar() {
  const letter = document.querySelector('.avatar');
  return letter ? letter.textContent.trim() : 'N';
}

function openPalette() {
  if (state.paletteItems.length && $('#palette-root .palette-layer.is-open')) return;
  if ($('.modal-layer.is-open')) closeModal();
  state.lastFocus = document.activeElement;
  state.paletteQuery = '';
  state.paletteIndex = 0;

  let root = $('#palette-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'palette-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="palette-layer">
      <div class="palette-backdrop" data-action="close-palette"></div>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div class="palette-search">
          ${icon('search')}
          <input id="palette-input" type="text" placeholder="Search pages, games, or actions…" autocomplete="off" spellcheck="false" aria-label="Search pages, games, or actions">
          <kbd>Esc</kbd>
        </div>
        <div class="palette-list" id="palette-list"></div>
        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span style="margin-left:auto">${optionAvatar()} · local profile</span>
        </div>
      </div>
    </div>
  `;
  const layer = $('.palette-layer', root);
  renderPaletteList();
  requestAnimationFrame(() => {
    layer.classList.add('is-open');
    const input = $('#palette-input');
    if (input) input.focus();
  });
}

function closePalette() {
  const layer = $('.palette-layer');
  if (!layer) return;
  layer.classList.remove('is-open');
  setTimeout(() => {
    const root = $('#palette-root');
    if (root && !$('.palette-layer.is-open')) root.innerHTML = '';
  }, 220);
  if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
    state.lastFocus.focus({ preventScroll: true });
  }
  state.paletteItems = [];
}

function renderPaletteList() {
  const list = $('#palette-list');
  if (!list) return;
  const items = filterPaletteItems();
  state.paletteItems = items;
  state.paletteIndex = clamp(state.paletteIndex, 0, Math.max(items.length - 1, 0));

  if (!items.length) {
    list.innerHTML = `<div class="palette-empty">No matches. Try a game name, “driver”, or “settings”.</div>`;
    return;
  }

  let lastGroup = '';
  list.innerHTML = items.map((item, index) => {
    const label = item.group !== lastGroup ? `<div class="palette-group-label">${esc(item.group)}</div>` : '';
    lastGroup = item.group;
    return `${label}
      <button class="palette-item${index === state.paletteIndex ? ' is-active' : ''}" type="button" data-command="${esc(item.command)}" data-index="${index}">
        <span class="palette-item-icon">${icon(item.iconName)}</span>
        <span class="palette-item-copy"><strong>${esc(item.title)}</strong><small>${esc(item.sub)}</small></span>
        ${icon('arrow-right', 'palette-enter')}
      </button>
    `;
  }).join('');
}

function setPaletteIndex(index) {
  const items = state.paletteItems;
  if (!items.length) return;
  state.paletteIndex = (index + items.length) % items.length;
  $$('.palette-item').forEach((item) => {
    item.classList.toggle('is-active', Number(item.dataset.index) === state.paletteIndex);
  });
  const active = $(`.palette-item[data-index="${state.paletteIndex}"]`);
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function runCommand(command) {
  closePalette();
  if (!command) return;
  if (command.startsWith('nav:')) {
    navigate(command.slice(4));
    return;
  }
  if (command === 'action:check-drivers') {
    navigate('drivers');
    setTimeout(checkDrivers, 120);
    return;
  }
  if (command === 'action:rescan-games') {
    rescanGames();
    return;
  }
  if (command === 'action:toggle-overlay') {
    togglePref('overlay');
    return;
  }
  if (command === 'action:driver-download') {
    const update = state.driver && state.driver.update;
    if (update && update.downloadUrl) {
      window.open(update.downloadUrl, '_blank', 'noopener,noreferrer');
      toast('Opening NVIDIA download', 'The official installer opens from nvidia.com.', 'info');
    }
    return;
  }
  if (command.startsWith('game:')) {
    const id = command.slice(5);
    if (state.route !== 'games') navigate('games');
    setTimeout(() => openGameSheet(id), 160);
  }
}

function handlePaletteKey(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setPaletteIndex(state.paletteIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setPaletteIndex(state.paletteIndex - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = state.paletteItems[state.paletteIndex];
    if (item) runCommand(item.command);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePalette();
  }
}

/* --------------------------------------------------------------------------
   Navigation and events
   -------------------------------------------------------------------------- */

function routeFromHash() {
  const value = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(value) ? value : 'home';
}

function navigate(route) {
  if (!ROUTES.includes(route)) route = 'home';
  closeMobileSidebar();
  if (location.hash !== `#/${route}`) {
    location.hash = `#/${route}`;
  } else if (state.route !== route) {
    state.route = route;
    renderRoute();
  }
}

function closeMobileSidebar() {
  const shell = $('#app-shell');
  if (shell) shell.classList.remove('sidebar-open');
}

function toggleMobileSidebar() {
  const shell = $('#app-shell');
  if (shell) shell.classList.toggle('sidebar-open');
}

function setHomePreset(key) {
  if (!PRESETS[key]) return;
  state.homePreset = key;
  $$('.preset-option[data-home-preset]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.homePreset === key);
  });
  const list = $('#home-tune-list');
  if (list) {
    list.innerHTML = Object.entries(PRESETS[key].settings).slice(0, 4).map(([label, value]) => `
      <div class="tune-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>
    `).join('');
  }
}

function clearSearch() {
  state.search = '';
  const input = $('#game-search');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clear = $('.search-clear');
  if (clear) clear.hidden = true;
  updateGameResults();
}

function clearFilters() {
  state.search = '';
  state.filter = 'all';
  renderRoute({ scroll: false });
  updateFilterCounts();
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function handleClick(event) {
  const play = event.target.closest('[data-play-id]');
  if (play) {
    event.preventDefault();
    event.stopPropagation();
    launchGame(play.dataset.playId);
    return;
  }

  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget) {
    event.preventDefault();
    navigate(routeTarget.dataset.route);
    return;
  }

  const nav = event.target.closest('[data-nav]');
  if (nav) {
    event.preventDefault();
    navigate(nav.dataset.nav);
    return;
  }

  const brand = event.target.closest('.brand');
  if (brand) {
    event.preventDefault();
    navigate('home');
    return;
  }

  const setting = event.target.closest('[data-setting]');
  if (setting) {
    togglePref(setting.dataset.setting);
    return;
  }

  const homePreset = event.target.closest('[data-home-preset]');
  if (homePreset) {
    setHomePreset(homePreset.dataset.homePreset);
    return;
  }

  const sheetPreset = event.target.closest('[data-sheet-preset]');
  if (sheetPreset) {
    updateSheetPreset(sheetPreset.dataset.sheetPreset);
    return;
  }

  const filter = event.target.closest('[data-filter]');
  if (filter) {
    state.filter = filter.dataset.filter;
    updateGameResults();
    return;
  }

  const command = event.target.closest('[data-command]');
  if (command) {
    event.preventDefault();
    runCommand(command.dataset.command);
    return;
  }

  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    const actions = {
      'toggle-sidebar': toggleMobileSidebar,
      'close-sidebar': closeMobileSidebar,
      'open-search': openPalette,
      'close-palette': closePalette,
      'close-sheet': closeGameSheet,
      'close-modal': closeModal,
      'check-drivers': checkDrivers,
      'rescan-games': rescanGames,
      'open-driver-modal': openDriverModal,
      'save-profile': saveSelectedProfile,
      'remove-profile': removeSelectedProfile,
      'toggle-live': toggleLive,
      'reset-prefs': openResetConfirm,
      'run-confirm': runConfirm,
      'copy-system': copySystem,
      'copy-driver-link': copyDriverLink,
      'clear-search': clearSearch,
      'clear-filters': clearFilters,
    };
    if (actions[action]) {
      event.preventDefault();
      actions[action]();
      return;
    }
  }

  const driverDownload = event.target.closest('[data-driver-download]');
  if (driverDownload) {
    toast('Opening NVIDIA download', 'Your browser is opening the official installer page.', 'info');
    return;
  }

  const card = event.target.closest('.game-card');
  if (card) {
    openGameSheet(card.dataset.gameId);
    return;
  }

  const recent = event.target.closest('.recent-game');
  if (recent) {
    openGameSheet(recent.dataset.gameId);
  }
}

function handleInput(event) {
  if (event.target.id === 'game-search') {
    state.search = event.target.value;
    const clear = $('.search-clear');
    if (clear) clear.hidden = !state.search;
    updateGameResults();
    return;
  }
  if (event.target.id === 'palette-input') {
    state.paletteQuery = event.target.value;
    state.paletteIndex = 0;
    renderPaletteList();
  }
}

function handleChange(event) {
  if (event.target.id === 'game-sort') {
    state.sort = event.target.value;
    updateGameResults();
  }
}

function trapOverlayFocus(event) {
  if (event.key !== 'Tab') return false;
  const layer =
    $('.palette-layer.is-open') ||
    $('.modal-layer.is-open') ||
    $('.sheet-layer.is-open');
  if (!layer) return false;

  const focusables = $$(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    layer
  ).filter((element) => element.getClientRects().length > 0);
  if (!focusables.length) return false;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;

  if (!layer.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function handleKeydown(event) {
  const paletteOpen = Boolean($('.palette-layer.is-open'));
  const modalOpen = Boolean($('.modal-layer.is-open'));
  const sheetOpen = Boolean($('.sheet-layer.is-open'));

  if (trapOverlayFocus(event)) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (paletteOpen) closePalette();
    else openPalette();
    return;
  }

  if (event.key === 'Escape') {
    if (paletteOpen) {
      event.preventDefault();
      closePalette();
    } else if (modalOpen) {
      event.preventDefault();
      closeModal();
    } else if (sheetOpen) {
      event.preventDefault();
      closeGameSheet();
    } else if ($('#app-shell.sidebar-open')) {
      closeMobileSidebar();
    }
    return;
  }

  if (paletteOpen) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
      const list = $('#palette-list');
      if (list && list.contains(event.target)) handlePaletteKey(event);
      else if (event.target.id === 'palette-input') handlePaletteKey(event);
    }
    return;
  }

  if (!isTypingTarget(event.target) && event.key === '/' && state.route === 'games') {
    event.preventDefault();
    const search = $('#game-search');
    if (search) search.focus();
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    const card = event.target.closest && event.target.closest('.game-card, .recent-game');
    if (card && event.target === card) {
      event.preventDefault();
      openGameSheet(card.dataset.gameId);
    }
  }
}

function bindEvents() {
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeydown);

  window.addEventListener('hashchange', () => {
    const next = routeFromHash();
    if (next === state.route) return;
    if ($('.sheet-layer.is-open')) closeGameSheet();
    state.route = next;
    renderRoute();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawRouteVisuals, 120);
  });

  document.addEventListener('error', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.classList.contains('game-cover')) return;
    const game = getGame(target.closest('.game-card')?.dataset.gameId);
    const fallback = document.createElement('div');
    fallback.className = 'game-fallback';
    fallback.style.setProperty('--game-accent', (game && game.accent) || '#76b900');
    fallback.innerHTML = `<span>${esc((game && (game.short || game.name.slice(0, 2))) || 'NA')}</span><small>Steam</small>`;
    target.replaceWith(fallback);
  }, true);
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
  const saved = loadJSON(STORAGE.prefs, {});
  state.prefs = { ...DEFAULT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
  const storedProfiles = loadJSON(STORAGE.profiles, null);
  state.profiles = storedProfiles && typeof storedProfiles === 'object' ? storedProfiles : null;

  state.route = routeFromHash();
  if (!location.hash) {
    history.replaceState(null, '', '#/home');
  }

  applyPreferences();
  bindEvents();
  updateChrome();
  await hydrate();
  startPolling();
}

init().catch((error) => {
  console.error(error);
  const view = $('#view');
  if (view) {
    view.innerHTML = `
      <div class="page">
        <div class="empty-state">
          <span class="empty-icon">${icon('info')}</span>
          <h3>The app could not start</h3>
          <p>${esc(error.message || 'An unexpected error occurred.')}</p>
          <button class="btn btn-secondary btn-sm" type="button" onclick="location.reload()">Try again</button>
        </div>
      </div>
    `;
  }
});

