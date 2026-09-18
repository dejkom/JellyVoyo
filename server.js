#!/usr/bin/env node

/**
 * JellyVoyo - Web Manager & Streaming Bridge Server
 *
 * Self-hosted management dashboard, multi-job scheduler, and streaming bridge
 * connecting Voyo.si video catalog to Jellyfin / Emby / Plex.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  VoyoClient,
  SyncEngine,
  convertAllVttInDirectory,
  generateMovieNfo,
  generateShowNfo,
  sanitizeName,
  padZero,
  extractYear
} from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable TLS rejection for local corporate / antivirus proxies
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const HISTORY_PATH = path.join(path.dirname(CONFIG_PATH), 'sync_history.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

export class VoyoManager {
  constructor() {
    this.config = this.loadConfig();
    this.history = this.loadHistory();
    this.token = null;
    this.user = null;
    this.profiles = [];
    this.isSyncing = false;
    this.currentRunningJobId = null;
    this.currentSyncEngine = null;
    this.logs = [];
    this.bridgeLogs = [];
    this.maxLogs = 500;
    this.jobTimers = new Map();

    this.voyoClient = new VoyoClient({
      apiUrl: this.config.apiUrl || 'https://gql.voyo.si/v2',
      siteId: this.config.siteId || 30005
    });

    this.initAllJobSchedulers();
  }

  loadConfig() {
    const defaults = {
      apiUrl: 'https://gql.voyo.si/v2',
      siteId: 30005,
      port: parseInt(process.env.PORT || '3851', 10),
      username: process.env.VOYO_USERNAME || '',
      password: process.env.VOYO_PASSWORD || '',
      profileId: null,
      profileName: '',
      bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3851',
      streamMode: 'auto',
      languagePreference: 'sl',
      jellyfinUrl: process.env.JELLYFIN_URL || '',
      jellyfinApiKey: process.env.JELLYFIN_API_KEY || '',
      jellyfinAutoRefresh: true,
      moviesDir: process.env.MOVIES_DIR || path.join(__dirname, 'media', 'MoviesVoyo'),
      showsDir: process.env.SHOWS_DIR || path.join(__dirname, 'media', 'ShowsVoyo'),
      jobs: [
        {
          id: 'job_movies_default',
          name: '🎬 Voyo Filmi (Movies 24h)',
          enabled: false,
          schedule: 'every_24h',
          targetDir: process.env.MOVIES_DIR || path.join(__dirname, 'media', 'MoviesVoyo'),
          mediaTypeFilter: 'movies',
          sortBy: 1,
          itemLimit: 0,
          minYear: null,
          minRating: null,
          selectedGenres: [],
          languagePreference: 'sl',
          lastRun: null,
          nextRun: null
        },
        {
          id: 'job_shows_default',
          name: '📺 Voyo Serije (Shows 8h)',
          enabled: false,
          schedule: 'every_8h',
          targetDir: process.env.SHOWS_DIR || path.join(__dirname, 'media', 'ShowsVoyo'),
          mediaTypeFilter: 'shows',
          sortBy: 1,
          itemLimit: 0,
          minYear: null,
          minRating: null,
          selectedGenres: [],
          languagePreference: 'sl',
          lastRun: null,
          nextRun: null
        }
      ],
      stats: {
        moviesCreated: 0,
        showsFound: 0,
        lastSyncTime: null
      }
    };

    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
      } catch (err) {
        console.warn(`⚠️ Failed reading config from ${CONFIG_PATH}: ${err.message}`);
      }
    }
    return defaults;
  }

  saveConfig() {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error(`⚠️ Failed saving config: ${err.message}`);
    }
  }

  loadHistory() {
    if (fs.existsSync(HISTORY_PATH)) {
      try {
        const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
        return JSON.parse(raw);
      } catch {}
    }
    return [];
  }

  saveHistory() {
    try {
      const dir = path.dirname(HISTORY_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(HISTORY_PATH, JSON.stringify(this.history.slice(0, 100), null, 2), 'utf8');
    } catch {}
  }

  addHistoryEntry(entry) {
    const fullEntry = {
      id: 'hist_' + Date.now(),
      timestamp: new Date().toLocaleString('sl-SI'),
      ...entry
    };
    this.history.unshift(fullEntry);
    this.saveHistory();
  }

  appendLog(msg) {
    const timestamp = new Date().toLocaleTimeString('sl-SI');
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry);
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
  }

  appendBridgeLog(msg) {
    const timestamp = new Date().toLocaleTimeString('sl-SI');
    const logEntry = `[${timestamp}] [Bridge] ${msg}`;
    console.log(logEntry);
    this.bridgeLogs.push(logEntry);
    if (this.bridgeLogs.length > this.maxLogs) this.bridgeLogs.shift();
  }

  getIntervalMs(schedule) {
    switch (schedule) {
      case 'every_1h': return 1 * 60 * 60 * 1000;
      case 'every_2h': return 2 * 60 * 60 * 1000;
      case 'every_4h': return 4 * 60 * 60 * 1000;
      case 'every_6h': return 6 * 60 * 60 * 1000;
      case 'every_8h': return 8 * 60 * 60 * 1000;
      case 'every_12h': return 12 * 60 * 60 * 1000;
      case 'every_24h':
      case 'daily': return 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  initAllJobSchedulers() {
    for (const timer of this.jobTimers.values()) {
      clearInterval(timer);
    }
    this.jobTimers.clear();

    if (!Array.isArray(this.config.jobs)) return;
    for (const job of this.config.jobs) {
      this.initJobScheduler(job);
    }
  }

  initJobScheduler(job) {
    if (!job || !job.id) return;

    if (this.jobTimers.has(job.id)) {
      clearInterval(this.jobTimers.get(job.id));
      this.jobTimers.delete(job.id);
    }

    if (!job.enabled || job.schedule === 'disabled' || !job.schedule) {
      job.nextRun = null;
      return;
    }

    const intervalMs = this.getIntervalMs(job.schedule);
    if (intervalMs > 0) {
      job.nextRun = new Date(Date.now() + intervalMs).toLocaleString('sl-SI');
      this.appendLog(`⏰ Scheduler set for "${job.name}": interval ${job.schedule}, next run at ${job.nextRun}`);

      const timer = setInterval(() => {
        this.appendLog(`⏰ Auto-sync triggered for job: "${job.name}"`);
        job.nextRun = new Date(Date.now() + intervalMs).toLocaleString('sl-SI');
        this.saveConfig();
        this.runJob(job.id, false, 'auto');
      }, intervalMs);

      this.jobTimers.set(job.id, timer);
    }
  }

  async triggerJellyfinRefresh() {
    const jellyfinUrl = (this.config.jellyfinUrl || '').replace(/\/+$/, '');
    const apiKey = this.config.jellyfinApiKey || '';

    if (!jellyfinUrl) {
      return { success: false, message: 'Jellyfin URL is not configured.' };
    }

    try {
      this.appendLog(`🔄 [Jellyfin] Sending library refresh request to ${jellyfinUrl}...`);
      const refreshUrl = `${jellyfinUrl}/Library/Refresh${apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''}`;
      
      const headers = {
        'User-Agent': 'JellyVoyo-Bridge/1.0',
        'Accept': 'application/json, text/plain, */*'
      };
      if (apiKey) {
        headers['X-Emby-Token'] = apiKey;
        headers['X-MediaBrowser-Token'] = apiKey;
      }

      const res = await fetch(refreshUrl, { method: 'POST', headers });
      if (res.ok || res.status === 204 || res.status === 200) {
        this.appendLog(`✅ [Jellyfin] Library refresh triggered successfully! (HTTP ${res.status})`);
        return { success: true, message: 'Jellyfin library refresh triggered successfully.' };
      }
      const errText = await res.text().catch(() => '');
      this.appendLog(`⚠️ [Jellyfin] Refresh request failed with HTTP ${res.status}: ${errText}`);
      return { success: false, message: `HTTP ${res.status}: ${errText}` };
    } catch (err) {
      this.appendLog(`❌ [Jellyfin] Connection error: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  async triggerSubtitleConversion(targetDirectory = null, force = false) {
    const dir = targetDirectory || this.config.moviesDir || path.resolve(__dirname, 'media');
    this.appendLog(`💬 [Subtitles] Starting mass VTT -> SRT conversion in: ${dir} (force: ${force})`);

    const stats = convertAllVttInDirectory(dir, force, (msg) => this.appendLog(`  ${msg}`));
    this.appendLog(`✅ Subtitle conversion complete! (${stats.found} found, ${stats.converted} converted, ${stats.skipped} skipped, ${stats.errors} errors)`);
    return { success: true, stats };
  }

  async login(username = null, password = null) {
    const user = username || this.config.username;
    const pass = password || this.config.password;

    if (!user || !pass) {
      return { success: false, message: 'Missing username or password' };
    }

    const loginRes = await this.voyoClient.login(user, pass);
    if (!loginRes.success) {
      return loginRes;
    }

    this.user = loginRes.user;
    this.token = loginRes.token;

    // Fetch all profiles
    const profRes = await this.voyoClient.getProfiles(this.token);
    if (profRes.success && profRes.profiles) {
      this.profiles = profRes.profiles;

      // Select target profile
      let targetProfile = null;
      if (this.config.profileId) {
        targetProfile = this.profiles.find(p => p.profileId === this.config.profileId);
      }
      if (!targetProfile) {
        targetProfile = this.profiles.find(p => p.type === 'normal') || this.profiles[0];
      }

      if (targetProfile) {
        this.config.profileId = targetProfile.profileId;
        this.config.profileName = targetProfile.name;
        const selRes = await this.voyoClient.selectProfile(targetProfile.profileId, this.token);
        if (selRes.success && selRes.token) {
          this.token = selRes.token;
          this.appendLog(`👤 Active Voyo profile: "${targetProfile.name}" (ID: ${targetProfile.profileId})`);
        }
      }
    }

    return {
      success: true,
      user: this.user,
      profiles: this.profiles,
      activeProfileId: this.config.profileId,
      activeProfileName: this.config.profileName
    };
  }

  async resolveMedia(mediaId) {
    // Ensure authenticated and active profile selected
    if (!this.token || !this.voyoClient.profileToken) {
      const auth = await this.login();
      if (!auth.success) throw new Error(auth.message);
    } else if (this.config.profileId && this.voyoClient.activeProfileId !== this.config.profileId) {
      // Switch profile if config changed
      await this.voyoClient.selectProfile(this.config.profileId);
    }

    let streamRes = await this.voyoClient.getVideoStream(mediaId);
    if (!streamRes.success) {
      // Re-login on auth expiry
      this.appendBridgeLog(`🔄 Re-authenticating with Voyo for media ${mediaId}...`);
      await this.login();
      streamRes = await this.voyoClient.getVideoStream(mediaId);
    }

    if (!streamRes.success || !streamRes.url) {
      throw new Error(streamRes.message || 'Stream URL could not be resolved');
    }

    return {
      streamUrl: streamRes.url,
      mediaName: `Voyo Media ${mediaId}`
    };
  }

  async runJob(jobId, force = false, triggerType = 'manual') {
    if (this.isSyncing) {
      return { success: false, message: 'Another synchronization is already in progress.' };
    }

    const job = (this.config.jobs || []).find(j => j.id === jobId);
    if (!job) {
      return { success: false, message: `Job with ID "${jobId}" not found.` };
    }

    this.isSyncing = true;
    this.currentRunningJobId = jobId;
    const startTime = Date.now();

    this.appendLog(`🚀 Starting job "${job.name}" [Trigger: ${triggerType}, Force: ${force}]`);

    try {
      // Ensure authenticated
      if (!this.token) {
        await this.login();
      }

      const outputDir = job.targetDir || this.config.moviesDir || path.resolve(__dirname, 'media');
      const isShows = job.mediaTypeFilter === 'shows';

      const engine = new SyncEngine({
        outputDir,
        moviesDir: isShows ? null : outputDir,
        showsDir: isShows ? outputDir : null,
        bridgeUrl: this.config.bridgeUrl,
        force,
        authToken: this.token,
        mediaTypeFilter: job.mediaTypeFilter || 'all',
        limit: job.itemLimit || null
      });

      this.currentSyncEngine = engine;
      await engine.init();
      await engine.syncCatalog(msg => this.appendLog(`  ${msg}`));

      const durationSec = Math.round((Date.now() - startTime) / 1000);
      job.lastRun = new Date().toLocaleString('sl-SI');
      this.saveConfig();

      const createdCount = engine.stats.moviesCreated + engine.stats.episodesCreated;
      this.addHistoryEntry({
        jobId: job.id,
        jobName: job.name,
        trigger: triggerType,
        status: 'completed',
        durationSec,
        moviesCreated: engine.stats.moviesCreated,
        episodesCreated: engine.stats.episodesCreated,
        skipped: engine.stats.itemsSkipped,
        errors: engine.stats.errors,
        summary: `Uspešno: +${createdCount} vsebin (${durationSec}s)`
      });

      this.appendLog(`✅ Job "${job.name}" finished in ${durationSec}s! (+${engine.stats.moviesCreated} movies, +${engine.stats.episodesCreated} episodes, ${engine.stats.itemsSkipped} skipped)`);

      if (createdCount > 0 && this.config.jellyfinAutoRefresh && this.config.jellyfinUrl) {
        this.appendLog(`🔄 [Jellyfin] New items added (${createdCount}). Refreshing library...`);
        this.triggerJellyfinRefresh().catch(() => {});
      }

      return { success: true, stats: engine.stats };
    } catch (err) {
      this.addHistoryEntry({
        jobId: job.id,
        jobName: job.name,
        trigger: triggerType,
        status: 'failed',
        error: err.message,
        summary: `Neuspešno: ${err.message}`
      });
      this.appendLog(`❌ Job "${job.name}" failed: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      this.isSyncing = false;
      this.currentRunningJobId = null;
      this.currentSyncEngine = null;
    }
  }

  async runSelectedItems(items, targetDir = null, force = false) {
    if (this.isSyncing) {
      return { success: false, message: 'Sinhronizacija že poteka.' };
    }

    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: 'Nobena vsebina ni izbrana.' };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    this.appendLog(`🚀 Začetek prenosa ${items.length} izbranih vsebin...`);

    try {
      if (!this.token) await this.login();

      const outputDir = targetDir || this.config.moviesDir || path.resolve(__dirname, 'media');
      const engine = new SyncEngine({
        outputDir,
        moviesDir: this.config.moviesDir || outputDir,
        showsDir: this.config.showsDir || outputDir,
        bridgeUrl: this.config.bridgeUrl,
        force,
        authToken: this.token
      });
      this.currentSyncEngine = engine;
      await engine.init();

      for (const item of items) {
        let meta = null;
        if (item.url) {
          meta = await this.voyoClient.fetchContentMetadata(item.url);
        }
        if (!meta) meta = item;

        const isShow = meta.type === 'series' || meta.media_type === 2 || !!meta.isSeries;
        if (!isShow && (meta.type === 'movie' || meta.media_type === 1 || meta.isSeries === false)) {
          this.appendLog(`🎬 Prenašam film: ${meta.title || meta.name}`);
          await engine.processMovie(meta);
        } else {
          this.appendLog(`📺 Prenašam serijo: ${meta.title || meta.name}`);
          await engine.processShow(meta);
        }
      }

      const durationSec = Math.round((Date.now() - startTime) / 1000);
      const createdCount = engine.stats.moviesCreated + engine.stats.episodesCreated;

      this.addHistoryEntry({
        jobName: `Izbrane vsebine (${items.length})`,
        trigger: 'manual',
        status: 'completed',
        durationSec,
        moviesCreated: engine.stats.moviesCreated,
        episodesCreated: engine.stats.episodesCreated,
        skipped: engine.stats.itemsSkipped,
        errors: engine.stats.errors,
        summary: `Uspešno: +${createdCount} vsebin (${durationSec}s)`
      });

      this.appendLog(`✅ Prenos izbranih vsebin končan v ${durationSec}s! (+${engine.stats.moviesCreated} filmov, +${engine.stats.episodesCreated} epizod, ${engine.stats.itemsSkipped} preskočeno)`);

      if (createdCount > 0 && this.config.jellyfinAutoRefresh && this.config.jellyfinUrl) {
        this.appendLog(`🔄 [Jellyfin] Nove vsebine dodane (${createdCount}). Osvežujem knjižnico...`);
        this.triggerJellyfinRefresh().catch(() => {});
      }

      return { success: true, stats: engine.stats };
    } catch (err) {
      this.appendLog(`❌ Napaka pri prenosu izbranih vsebin: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      this.isSyncing = false;
      this.currentSyncEngine = null;
    }
  }

  async refreshDirectoryMetadata(folderPath) {
    const absolutePath = path.resolve(folderPath);
    if (!fs.existsSync(absolutePath)) {
      return { success: false, message: 'Directory does not exist' };
    }

    this.appendLog(`🖼️ [Explorer] Refreshing metadata for: ${path.basename(absolutePath)}...`);

    // Scan for .strm to find mediaId
    let mediaId = null;
    const findStrm = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) findStrm(full);
        else if (ent.name.endsWith('.strm')) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            const m = content.match(/\/play\/(\d+)/);
            if (m) {
              mediaId = m[1];
              return;
            }
          } catch {}
        }
      }
    };
    findStrm(absolutePath);

    const folderName = path.basename(absolutePath);
    const cleanTitle = folderName.replace(/\s*\(\d{4}\).*$/, '').trim();

    // Query metadata
    let meta = null;
    if (mediaId) {
      meta = await this.voyoClient.fetchContentMetadata(`https://voyo.si/vsebina/vsebina_${mediaId}.html`);
    }

    const isShow = fs.existsSync(path.join(absolutePath, 'tvshow.nfo')) ||
                   fs.readdirSync(absolutePath).some(f => f.toLowerCase().startsWith('season'));

    if (meta) {
      if (isShow) {
        fs.writeFileSync(path.join(absolutePath, 'tvshow.nfo'), generateShowNfo(meta, folderName), 'utf8');
      } else {
        fs.writeFileSync(path.join(absolutePath, 'movie.nfo'), generateMovieNfo(meta, folderName), 'utf8');
      }

      // Re-download poster / fanart if available
      const img = meta.imageUrl || meta.thumbnailUrl;
      if (img) {
        try {
          const res = await fetch(img, { headers: CONFIG.headers });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(path.join(absolutePath, 'poster.jpg'), buf);
            fs.writeFileSync(path.join(absolutePath, 'fanart.jpg'), buf);
          }
        } catch {}
      }
      return { success: true, message: `Metadata refreshed for "${folderName}"` };
    }

    return { success: false, message: `Could not fetch metadata for "${cleanTitle}"` };
  }

  // HTTP Server Definition
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 1. Streaming Bridge: /play/:mediaId
        if (reqUrl.pathname.startsWith('/play/')) {
          const mediaId = reqUrl.pathname.replace('/play/', '');
          this.appendBridgeLog(`🎬 Stream request received for ID: ${mediaId} from ${req.socket.remoteAddress}`);

          try {
            const mediaInfo = await this.resolveMedia(mediaId);

            // If streamMode is 'redirect', perform HTTP 302
            if (this.config.streamMode === 'redirect') {
              this.appendBridgeLog(`▶️ [Redirect Mode] Redirecting to HLS master for media ID: ${mediaId}`);
              res.writeHead(302, {
                'Location': mediaInfo.streamUrl,
                'Access-Control-Allow-Origin': '*'
              });
              res.end();
              return;
            }

            // Default: Proxy mode (rewrites playlist to route through bridge)
            this.appendBridgeLog(`▶️ [Proxy Mode] Serving proxied HLS master playlist for media ID: ${mediaId}`);
            const masterRes = await fetch(mediaInfo.streamUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://voyo.si',
                'Referer': 'https://voyo.si/'
              }
            });

            if (!masterRes.ok) {
              throw new Error(`Master playlist returned status ${masterRes.status}`);
            }

            let masterContent = await masterRes.text();
            // Rewrite sub-playlist URLs (hd.m3u8, etc.) to go through bridge /proxy/playlist
            masterContent = masterContent.replace(/(https:\/\/[^\s\r\n]+\.m3u8[^\s\r\n]*)/g, (match) => {
              return `/proxy/playlist?url=${encodeURIComponent(match)}`;
            });

            res.writeHead(200, {
              'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            });
            res.end(masterContent);
          } catch (err) {
            this.appendBridgeLog(`❌ Stream resolution failed for ID ${mediaId}: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // Sub-playlist proxy: rewrites TS segments & AES Keys
        if (reqUrl.pathname === '/proxy/playlist') {
          const targetUrl = reqUrl.searchParams.get('url');
          if (!targetUrl) {
            res.writeHead(400);
            res.end('Missing url param');
            return;
          }

          try {
            const plRes = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://voyo.si',
                'Referer': 'https://voyo.si/'
              }
            });
            if (!plRes.ok) throw new Error(`Playlist returned ${plRes.status}`);
            let content = await plRes.text();

            // Rewrite AES-128 URI keys to route through /proxy/key
            content = content.replace(/URI="([^"]+)"/g, (match, keyUrl) => {
              return `URI="/proxy/key?url=${encodeURIComponent(keyUrl)}"`;
            });

            // Rewrite TS segments to route through /proxy/segment
            content = content.replace(/(https:\/\/[^\s\r\n]+\.ts[^\s\r\n]*)/g, (match) => {
              return `/proxy/segment?url=${encodeURIComponent(match)}`;
            });

            res.writeHead(200, {
              'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            });
            res.end(content);
          } catch (err) {
            res.writeHead(500);
            res.end(err.message);
          }
          return;
        }

        // Key proxy: fetches decryption key directly with valid origin/referer
        if (reqUrl.pathname === '/proxy/key') {
          const keyUrl = reqUrl.searchParams.get('url');
          if (!keyUrl) {
            res.writeHead(400);
            res.end('Missing key url');
            return;
          }

          try {
            const keyRes = await fetch(keyUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://voyo.si',
                'Referer': 'https://voyo.si/'
              }
            });
            const keyBuffer = Buffer.from(await keyRes.arrayBuffer());
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600'
            });
            res.end(keyBuffer);
          } catch (err) {
            res.writeHead(500);
            res.end(err.message);
          }
          return;
        }

        // Segment proxy: pipes MPEG-TS segments smoothly to Jellyfin with open CORS
        if (reqUrl.pathname === '/proxy/segment') {
          const segUrl = reqUrl.searchParams.get('url');
          if (!segUrl) {
            res.writeHead(400);
            res.end('Missing segment url');
            return;
          }

          try {
            const segRes = await fetch(segUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://voyo.si',
                'Referer': 'https://voyo.si/'
              }
            });
            const segBuffer = Buffer.from(await segRes.arrayBuffer());
            res.writeHead(200, {
              'Content-Type': 'video/mp2t',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=86400'
            });
            res.end(segBuffer);
          } catch (err) {
            res.writeHead(500);
            res.end(err.message);
          }
          return;
        }

        // 2. Settings API
        if (reqUrl.pathname === '/api/settings' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(this.config));
          return;
        }

        if (reqUrl.pathname === '/api/settings' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const updated = JSON.parse(body);
              this.config.username = updated.username ?? this.config.username;
              this.config.password = updated.password ?? this.config.password;
              this.config.profileId = updated.profileId !== undefined ? updated.profileId : this.config.profileId;
              this.config.profileName = updated.profileName !== undefined ? updated.profileName : this.config.profileName;
              this.config.bridgeUrl = updated.bridgeUrl ?? this.config.bridgeUrl;
              this.config.port = updated.port ?? this.config.port;
              this.config.streamMode = updated.streamMode ?? this.config.streamMode ?? 'proxy';
              this.config.languagePreference = updated.languagePreference ?? this.config.languagePreference;
              this.config.jellyfinUrl = updated.jellyfinUrl !== undefined ? updated.jellyfinUrl : this.config.jellyfinUrl;
              this.config.jellyfinApiKey = updated.jellyfinApiKey !== undefined ? updated.jellyfinApiKey : this.config.jellyfinApiKey;
              this.config.jellyfinAutoRefresh = updated.jellyfinAutoRefresh !== undefined ? !!updated.jellyfinAutoRefresh : this.config.jellyfinAutoRefresh;
              this.saveConfig();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, config: this.config }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 3. Voyo Auth & Profile API
        if (reqUrl.pathname === '/api/auth/test' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const username = payload.username || this.config.username;
              const password = payload.password || this.config.password;
              const result = await this.login(username, password);
              res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname === '/api/voyo/profiles' && req.method === 'GET') {
          if (!this.token) await this.login();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            profiles: this.profiles,
            activeProfileId: this.config.profileId,
            activeProfileName: this.config.profileName
          }));
          return;
        }

        if (reqUrl.pathname === '/api/voyo/select-profile' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { profileId, profileName } = JSON.parse(body);
              this.config.profileId = parseInt(profileId, 10);
              this.config.profileName = profileName || '';
              this.saveConfig();

              if (this.token) {
                const sel = await this.voyoClient.selectProfile(this.config.profileId, this.token);
                if (sel.success && sel.token) this.token = sel.token;
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, profileId: this.config.profileId }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 4. Jellyfin Integration Test
        if (reqUrl.pathname === '/api/jellyfin/test' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              if (payload.jellyfinUrl !== undefined) this.config.jellyfinUrl = payload.jellyfinUrl;
              if (payload.jellyfinApiKey !== undefined) this.config.jellyfinApiKey = payload.jellyfinApiKey;
              const result = await this.triggerJellyfinRefresh();
              res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 5. Subtitle Tool: VTT -> SRT
        if (reqUrl.pathname === '/api/tools/convert-subtitles' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const result = await this.triggerSubtitleConversion(payload.targetPath, payload.force);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 6. File Explorer
        if (reqUrl.pathname === '/api/explorer/roots' && req.method === 'GET') {
          const roots = new Set();
          if (this.config.moviesDir) roots.add(path.resolve(this.config.moviesDir));
          if (this.config.showsDir) roots.add(path.resolve(this.config.showsDir));
          if (Array.isArray(this.config.jobs)) {
            for (const j of this.config.jobs) {
              if (j.targetDir) roots.add(path.resolve(j.targetDir));
            }
          }
          if (roots.size === 0) roots.add(path.resolve(__dirname, 'media'));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, roots: Array.from(roots) }));
          return;
        }

        if (reqUrl.pathname === '/api/explorer/tree' && req.method === 'GET') {
          const reqPath = reqUrl.searchParams.get('path');
          if (!reqPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing path' }));
            return;
          }
          const absolutePath = path.resolve(reqPath);
          if (!fs.existsSync(absolutePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Path not found' }));
            return;
          }

          try {
            const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
            const items = entries.map(entry => {
              const itemPath = path.join(absolutePath, entry.name);
              let stat = null;
              try { stat = fs.statSync(itemPath); } catch {}
              const isDir = entry.isDirectory();
              let childCount = 0;
              if (isDir) {
                try { childCount = fs.readdirSync(itemPath).length; } catch {}
              }
              return {
                name: entry.name,
                path: itemPath,
                isDirectory: isDir,
                sizeBytes: stat ? stat.size : 0,
                mtime: stat ? stat.mtime.toISOString() : null,
                childCount
              };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, currentPath: absolutePath, items }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        if (reqUrl.pathname === '/api/explorer/file' && req.method === 'GET') {
          const filePath = reqUrl.searchParams.get('path');
          if (!filePath || !fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'File not found' }));
            return;
          }
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, content }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        if (reqUrl.pathname === '/api/explorer/file' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const { path: filePath, content } = JSON.parse(body);
              fs.writeFileSync(filePath, content, 'utf8');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname === '/api/explorer/item' && req.method === 'DELETE') {
          const itemPath = reqUrl.searchParams.get('path');
          if (!itemPath || !fs.existsSync(itemPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Path not found' }));
            return;
          }
          try {
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(itemPath);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        if (reqUrl.pathname === '/api/explorer/refresh-metadata' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { folderPath } = JSON.parse(body);
              const result = await this.refreshDirectoryMetadata(folderPath);
              res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 7. Multi-Job Scheduler API
        if (reqUrl.pathname === '/api/jobs' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, jobs: this.config.jobs || [] }));
          return;
        }

        if (reqUrl.pathname === '/api/jobs' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const jobData = JSON.parse(body);
              if (!this.config.jobs) this.config.jobs = [];

              let targetJob = null;
              if (jobData.id) {
                const idx = this.config.jobs.findIndex(j => j.id === jobData.id);
                if (idx !== -1) {
                  this.config.jobs[idx] = { ...this.config.jobs[idx], ...jobData };
                  targetJob = this.config.jobs[idx];
                }
              }

              if (!targetJob) {
                targetJob = {
                  id: 'job_' + Date.now(),
                  name: jobData.name || 'Novo opravilo',
                  enabled: jobData.enabled !== undefined ? !!jobData.enabled : true,
                  schedule: jobData.schedule || 'every_24h',
                  targetDir: jobData.targetDir || this.config.moviesDir,
                  mediaTypeFilter: jobData.mediaTypeFilter || 'all',
                  itemLimit: parseInt(jobData.itemLimit || '0', 10),
                  minYear: jobData.minYear || null,
                  minRating: jobData.minRating || null,
                  selectedGenres: jobData.selectedGenres || [],
                  languagePreference: jobData.languagePreference || 'sl',
                  lastRun: null,
                  nextRun: null
                };
                this.config.jobs.push(targetJob);
              }

              this.initJobScheduler(targetJob);
              this.saveConfig();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, job: targetJob, jobs: this.config.jobs }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname === '/api/jobs/run' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { jobId, force } = JSON.parse(body || '{}');
              this.runJob(jobId, !!force, 'manual');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Job started' }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname === '/api/jobs/delete' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const { jobId } = JSON.parse(body);
              if (this.jobTimers.has(jobId)) {
                clearInterval(this.jobTimers.get(jobId));
                this.jobTimers.delete(jobId);
              }
              this.config.jobs = (this.config.jobs || []).filter(j => j.id !== jobId);
              this.saveConfig();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, jobs: this.config.jobs }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 8. Sync Preview API
        if (reqUrl.pathname === '/api/sync/preview' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { mediaTypeFilter, limit, refresh } = JSON.parse(body || '{}');
              const allCatalog = await this.voyoClient.fetchCatalog({ refresh: !!refresh });
              const totalShows = allCatalog.filter(i => i.isSeries).length;
              const totalMovies = allCatalog.filter(i => !i.isSeries).length;

              let filtered = allCatalog;
              if (mediaTypeFilter === 'movies') filtered = filtered.filter(i => !i.isSeries);
              else if (mediaTypeFilter === 'shows') filtered = filtered.filter(i => i.isSeries);

              const itemsToReturn = (limit && limit > 0) ? filtered.slice(0, limit) : filtered;

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                totalFound: filtered.length,
                totalShows,
                totalMovies,
                items: itemsToReturn
              }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 8b. Run Sync for Selected Items
        if (reqUrl.pathname === '/api/sync/run-selected' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { items, targetDir, force } = JSON.parse(body || '{}');
              this.runSelectedItems(items, targetDir, !!force);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Prenos zagnan v ozadju' }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 9. Sync Status & Control
        if (reqUrl.pathname === '/api/sync/status' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            isSyncing: this.isSyncing,
            currentJobId: this.currentRunningJobId,
            stats: this.currentSyncEngine?.stats || this.config.stats
          }));
          return;
        }

        // 10. Audit History & Logs
        if (reqUrl.pathname === '/api/history' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, history: this.history }));
          return;
        }

        if (reqUrl.pathname === '/api/history' && req.method === 'DELETE') {
          this.history = [];
          this.saveHistory();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (reqUrl.pathname === '/api/logs' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ logs: this.logs, bridgeLogs: this.bridgeLogs }));
          return;
        }

        if (reqUrl.pathname === '/api/logs' && req.method === 'DELETE') {
          this.logs = [];
          this.bridgeLogs = [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // 11. Static Dashboard GUI Assets
        let filePath = path.join(PUBLIC_DIR, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.ico': 'image/x-icon'
          };
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        // 404 Fallback
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      const port = this.config.port || 3851;
      this.server.listen(port, () => {
        this.appendLog(`🎬 JellyVoyo Web Manager & Streaming Bridge running at http://localhost:${port}`);
        resolve();
      });
    });
  }
}

// Start standalone server if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const manager = new VoyoManager();
  manager.start().catch(err => {
    console.error(`Fatal server error: ${err.message}`);
    process.exit(1);
  });
}
