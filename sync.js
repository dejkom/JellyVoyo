#!/usr/bin/env node

/**
 * JellyVoyo - Voyo.si to Jellyfin .strm Catalog Synchronizer
 *
 * Connects to Voyo.si GraphQL API & Web Catalog, retrieves movies and series,
 * and creates a Jellyfin/TMDB-compliant directory structure with .strm files,
 * official artwork, localized .nfo metadata, and dual WebVTT/SRT subtitles.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable TLS rejection for local / proxy environments if needed
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// ==========================================
// Configuration & Defaults
// ==========================================
export const CONFIG = {
  apiBaseUrl: process.env.VOYO_API_URL || 'https://gql.voyo.si/v2',
  voyoBaseUrl: 'https://voyo.si',
  siteId: 30005,
  bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3851',
  defaultOutputDir: path.resolve(__dirname, 'media'),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Origin': 'https://voyo.si',
    'Referer': 'https://voyo.si/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7'
  },
  timeoutMs: 15000
};

// ==========================================
// CLI Argument Parsing
// ==========================================
export function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outputDir: CONFIG.defaultOutputDir,
    moviesDir: null,
    showsDir: null,
    force: false,
    dryRun: false,
    help: false,
    apiUrl: CONFIG.apiBaseUrl,
    bridgeUrl: CONFIG.bridgeUrl,
    limit: null,
    mediaTypeFilter: 'all', // 'all', 'movies', 'shows'
    selectedGenres: [],
    minYear: null,
    minRating: null,
    authToken: process.env.VOYO_TOKEN || null,
    username: process.env.VOYO_USERNAME || '',
    password: process.env.VOYO_PASSWORD || '',
    profileId: process.env.VOYO_PROFILE_ID ? parseInt(process.env.VOYO_PROFILE_ID, 10) : null,
    languagePreference: 'sl'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--output' || arg === '-o') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.outputDir = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg.startsWith('--output=')) {
      options.outputDir = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (arg === '--api-url') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.apiUrl = args[++i];
      }
    } else if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.split('=')[1];
    } else if (arg === '--limit') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.limit = parseInt(args[++i], 10);
      }
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--token') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.authToken = args[++i];
      }
    } else if (arg.startsWith('--token=')) {
      options.authToken = arg.split('=')[1];
    } else if (arg === '--username' || arg === '-u') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.username = args[++i];
      }
    } else if (arg === '--password' || arg === '-p') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.password = args[++i];
      }
    } else if (arg === '--profile') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.profileId = parseInt(args[++i], 10);
      }
    } else if (arg.startsWith('--profile=')) {
      options.profileId = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

export function showHelp() {
  console.log(`
JellyVoyo - Voyo.si to Jellyfin .strm Catalog Synchronizer

Usage:
  node sync.js [options]

Options:
  -o, --output <dir>       Set base output directory (default: ./media)
  -f, --force              Overwrite existing .strm files
  -d, --dry-run            Simulate sync process without writing to disk
      --limit <number>     Limit total items processed per category
      --token <jwt>        Provide Voyo profile token
  -u, --username <user>    Voyo username (email) to log in automatically
  -p, --password <pass>    Voyo password to log in automatically
      --profile <id>       Voyo profile ID to use
      --api-url <url>      Custom Voyo GraphQL URL (default: https://gql.voyo.si/v2)
  -h, --help               Show this help message

Examples:
  node sync.js
  node sync.js --dry-run --limit 5
  node sync.js --username myuser@example.com --password mypass
`);
}

// ==========================================
// Utilities
// ==========================================

/**
 * Sanitize filename strings by stripping invisible unicode artifacts,
 * and illegal filesystem characters: / \\ : * ? " < > |
 */
export function sanitizeName(name) {
  if (!name) return '';
  return name
    .toString()
    // Strip zero-width and control characters
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u0000-\u001F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '') // remove forbidden characters
    .replace(/\s+/g, ' ')         // normalize multiple spaces
    .trim();
}

/**
 * Format two-digit number (e.g. 1 -> "01")
 */
export function padZero(num) {
  return String(num).padStart(2, '0');
}

/**
 * Extract 4-digit release year from date or year field.
 */
export function extractYear(releaseDate, defaultYear = '') {
  if (!releaseDate) return defaultYear;
  const match = String(releaseDate).match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : defaultYear;
}

/**
 * Parse ISO 8601 duration (e.g. PT2H3M38S -> 123 minutes)
 */
export function parseDuration(durationStr) {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const match = String(durationStr).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return parseInt(durationStr, 10) || 0;
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  return (hours * 60) + minutes;
}

/**
 * Escape special XML characters for safe inclusion in .nfo files
 */
export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts WebVTT formatted subtitle text into standard SubRip (.srt) format
 */
export function vttToSrt(vttContent) {
  if (!vttContent || typeof vttContent !== 'string') return '';

  let clean = vttContent.replace(/^\uFEFF?WEBVTT[^\r\n]*(\r\n|\n|\r)/, '');
  clean = clean.replace(/NOTE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/STYLE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/REGION(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');

  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rawBlocks = clean.split(/\n{2,}/);
  const srtBlocks = [];
  let counter = 1;

  const timestampRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    let timestampLineIndex = -1;
    let match = null;

    for (let i = 0; i < lines.length; i++) {
      match = lines[i].match(timestampRegex);
      if (match) {
        timestampLineIndex = i;
        break;
      }
    }

    if (timestampLineIndex === -1 || !match) {
      continue;
    }

    const formatTime = (h, m, s, ms) => {
      const hours = padZero(parseInt(h || '0', 10));
      const minutes = padZero(parseInt(m, 10));
      const seconds = padZero(parseInt(s, 10));
      const milliseconds = String(ms).padEnd(3, '0').slice(0, 3);
      return `${hours}:${minutes}:${seconds},${milliseconds}`;
    };

    const startTime = formatTime(match[1], match[2], match[3], match[4]);
    const endTime = formatTime(match[5], match[6], match[7], match[8]);
    const srtTimestamp = `${startTime} --> ${endTime}`;

    const textLines = lines.slice(timestampLineIndex + 1).map(line => {
      return line.replace(/<\/?[^>]+(>|$)/g, '').trim();
    }).filter(line => line.length > 0);

    if (textLines.length > 0) {
      srtBlocks.push(`${counter}\n${srtTimestamp}\n${textLines.join('\n')}`);
      counter++;
    }
  }

  return srtBlocks.join('\n\n') + (srtBlocks.length > 0 ? '\n' : '');
}

/**
 * Generate Kodi/Jellyfin compatible movie.nfo XML content
 */
export function generateMovieNfo(movie, resolvedTitle = '') {
  const title = resolvedTitle || movie.name || movie.media_name || movie.media_name_en || movie.title || '';
  const originalTitle = movie.media_name_en || movie.original_title || movie.media_name || '';
  const plot = movie.description || movie.media_description || movie.media_synopsis || movie.plot || '';
  const rawYear = movie.year || movie.media_year || movie.release_date || movie.uploadDate || movie.trailer?.uploadDate;
  const year = extractYear(rawYear, '');
  const rating = parseFloat(movie.rating || movie.media_rating || 0) || 0;
  
  let rawGenres = movie.genre || movie.media_genres || [];
  if (!Array.isArray(rawGenres)) rawGenres = [rawGenres];
  const genres = rawGenres.map(g => typeof g === 'object' ? (g.genre_name || g.name) : g).filter(Boolean);

  let rawActors = movie.actor || movie.actors || [];
  if (!Array.isArray(rawActors)) rawActors = [rawActors];
  const actors = rawActors.map(a => typeof a === 'object' ? a.name : a).filter(Boolean);

  let rawDirectors = movie.director || movie.directors || [];
  if (!Array.isArray(rawDirectors)) rawDirectors = [rawDirectors];
  const directors = rawDirectors.map(d => typeof d === 'object' ? d.name : d).filter(Boolean);

  const durationMin = parseDuration(movie.duration || movie.media_duration);

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  xml += `<movie>\n`;
  xml += `  <title>${escapeXml(title)}</title>\n`;
  if (originalTitle && originalTitle !== title) {
    xml += `  <originaltitle>${escapeXml(originalTitle)}</originaltitle>\n`;
  }
  if (plot) {
    xml += `  <plot>${escapeXml(plot)}</plot>\n`;
    xml += `  <outline>${escapeXml(plot.slice(0, 200))}</outline>\n`;
  }
  if (year) {
    xml += `  <year>${escapeXml(year)}</year>\n`;
  }
  if (rating > 0) {
    xml += `  <rating>${rating.toFixed(1)}</rating>\n`;
  }
  for (const g of genres) {
    xml += `  <genre>${escapeXml(g)}</genre>\n`;
  }
  for (const d of directors) {
    xml += `  <director>${escapeXml(d)}</director>\n`;
  }
  for (const a of actors) {
    xml += `  <actor>\n    <name>${escapeXml(a)}</name>\n    <role></role>\n  </actor>\n`;
  }
  if (durationMin > 0) {
    xml += `  <runtime>${durationMin}</runtime>\n`;
  }
  xml += `</movie>\n`;
  return xml;
}

/**
 * Generate Kodi/Jellyfin compatible tvshow.nfo XML content
 */
export function generateShowNfo(show, resolvedTitle = '') {
  let title = resolvedTitle || show.name || show.series_name || show.show_name || show.title || '';
  if (!title || title.toLowerCase().startsWith('epizoda') || title.toLowerCase() === 'untitled') {
    title = show.series_name || show.show_name || show.original_title || show.name || '';
  }
  const originalTitle = show.original_title || show.series_name_en || show.media_name_en || '';
  const plot = show.description || show.media_description || show.synopsis || '';
  const rawYear = show.year || show.media_year || show.first_air_date || show.uploadDate || show.trailer?.uploadDate;
  const year = extractYear(rawYear, '');
  const rating = parseFloat(show.rating || show.media_rating || 0) || 0;
  
  let rawGenres = show.genre || show.media_genres || [];
  if (!Array.isArray(rawGenres)) rawGenres = [rawGenres];
  const genres = rawGenres.map(g => typeof g === 'object' ? (g.genre_name || g.name) : g).filter(Boolean);

  let rawActors = show.actor || show.actors || [];
  if (!Array.isArray(rawActors)) rawActors = [rawActors];
  const actors = rawActors.map(a => typeof a === 'object' ? a.name : a).filter(Boolean);

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  xml += `<tvshow>\n`;
  xml += `  <title>${escapeXml(title)}</title>\n`;
  if (originalTitle && originalTitle !== title && !originalTitle.toLowerCase().startsWith('epizoda')) {
    xml += `  <originaltitle>${escapeXml(originalTitle)}</originaltitle>\n`;
  }
  if (plot) {
    xml += `  <plot>${escapeXml(plot)}</plot>\n`;
    xml += `  <outline>${escapeXml(plot.slice(0, 200))}</outline>\n`;
  }
  if (year) {
    xml += `  <year>${escapeXml(year)}</year>\n`;
  }
  if (rating > 0) {
    xml += `  <rating>${rating.toFixed(1)}</rating>\n`;
  }
  for (const g of genres) {
    xml += `  <genre>${escapeXml(g)}</genre>\n`;
  }
  for (const a of actors) {
    xml += `  <actor>\n    <name>${escapeXml(a)}</name>\n    <role></role>\n  </actor>\n`;
  }
  xml += `</tvshow>\n`;
  return xml;
}

/**
 * Recursively find and convert all .vtt subtitles to .srt format in given directory
 */
export function convertAllVttInDirectory(dirPath, force = false, onProgress = null) {
  const stats = { found: 0, converted: 0, skipped: 0, errors: 0 };
  if (!fs.existsSync(dirPath)) return stats;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.vtt')) {
        stats.found++;
        const srtPath = fullPath.slice(0, -4) + '.srt';
        if (fs.existsSync(srtPath) && !force) {
          stats.skipped++;
          continue;
        }
        try {
          const vttContent = fs.readFileSync(fullPath, 'utf8');
          const srtContent = vttToSrt(vttContent);
          if (srtContent && srtContent.trim().length > 0) {
            fs.writeFileSync(srtPath, srtContent, 'utf8');
            stats.converted++;
            if (onProgress) onProgress(`Converted: ${path.basename(fullPath)} -> ${path.basename(srtPath)}`);
          } else {
            stats.skipped++;
          }
        } catch (err) {
          stats.errors++;
          if (onProgress) onProgress(`Error converting ${entry.name}: ${err.message}`);
        }
      }
    }
  }

  walk(dirPath);
  return stats;
}

// ==========================================
// Voyo GraphQL & Scraper Client
// ==========================================
export class VoyoClient {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || CONFIG.apiBaseUrl;
    this.siteId = options.siteId || CONFIG.siteId;
    this.token = options.token || null;
    this.headers = {
      ...CONFIG.headers,
      ...(options.headers || {})
    };
  }

  setToken(token) {
    this.token = token;
  }

  /**
   * Login user with Voyo credentials
   */
  async login(email, password) {
    console.log(`🔑 Logging into Voyo as "${email}"...`);
    const query = {
      query: `query loginUser($email: String! $siteId: Int! $password: String!) {
        login(email: $email, siteId: $siteId, password: $password) {
          id token email profileId isSubscribed nickname subscriptionUntil
        }
      }`,
      variables: { email, password, siteId: this.siteId }
    };

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(query)
      });
      const data = await res.json();
      if (data.data?.login?.token) {
        this.userToken = data.data.login.token;
        this.token = this.userToken;
        console.log(`✅ Logged in successfully as ${data.data.login.nickname || email}`);
        return { success: true, user: data.data.login, token: this.token };
      }
      const errMsg = data.errors?.[0]?.message || 'Login failed';
      console.warn(`⚠️ Voyo login failed: ${errMsg}`);
      return { success: false, message: errMsg };
    } catch (err) {
      console.warn(`⚠️ Voyo login request error: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * Get all user profiles
   */
  async getProfiles(tokenOverride = null) {
    const token = tokenOverride || this.token;
    if (!token) return { success: false, message: 'No authentication token available' };

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({
          query: `query userProfiles {
            userProfiles {
              profiles {
                profileId visitorId type name avatar url
              }
            }
          }`
        })
      });
      const data = await res.json();
      if (data.data?.userProfiles?.profiles) {
        return { success: true, profiles: data.data.userProfiles.profiles };
      }
      return { success: false, message: data.errors?.[0]?.message || 'Failed to fetch profiles' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Switch to a specific profile
   */
  async selectProfile(profileId, tokenOverride = null) {
    const token = tokenOverride || this.userToken || this.token;
    if (!token) return { success: false, message: 'No authentication token available' };

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({
          query: `query loginProfile($profileId: Int!) {
            loginProfile(profileId: $profileId) {
              id token email profileId nickname isSubscribed
            }
          }`,
          variables: { profileId: parseInt(profileId, 10) }
        })
      });
      const data = await res.json();
      if (data.data?.loginProfile?.token) {
        this.profileToken = data.data.loginProfile.token;
        this.token = this.profileToken;
        this.activeProfileId = parseInt(profileId, 10);
        return { success: true, profile: data.data.loginProfile, token: this.token };
      }
      return { success: false, message: data.errors?.[0]?.message || 'Failed to select profile' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Resolve video streaming URL via VideoUrlV2 query
   */
  async getVideoStream(mediaId, tokenOverride = null) {
    const token = tokenOverride || this.profileToken || this.token;
    const query = {
      query: `query VideoUrlV2($id: Int!, $siteId: Int) {
        videoUrlV2 (id: $id, siteId: $siteId) {
          url info infoCode license
        }
      }`,
      variables: { id: parseInt(mediaId, 10), siteId: this.siteId }
    };

    try {
      const headers = {
        ...this.headers,
        'Content-Type': 'application/json'
      };
      if (token) headers['Authorization'] = token;

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(query)
      });
      const data = await res.json();
      const videoResult = data.data?.videoUrlV2;
      if (videoResult && videoResult.url && !videoResult.url.includes('NOVIDEO')) {
        return { success: true, url: videoResult.url, info: videoResult.info };
      }
      const errMsg = videoResult?.info || data.errors?.[0]?.message || 'Stream unavailable or inactive subscription';
      return { success: false, message: errMsg };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Fetch content metadata by URL or ID from Voyo.si
   */
  async fetchContentMetadata(contentUrl) {
    let fullUrl = contentUrl.startsWith('http') ? contentUrl : `https://voyo.si${contentUrl.startsWith('/') ? '' : '/'}${contentUrl}`;
    if (!fullUrl.includes('/vsebina/')) {
      fullUrl = fullUrl.replace(/voyo\.si\//, 'voyo.si/vsebina/');
    }
    try {
      const res = await fetch(fullUrl, { headers: this.headers });
      if (!res.ok) return null;
      const html = await res.text();

      // Extract JSON-LD blocks
      const jsonLdBlocks = [...html.matchAll(/<script type=["']?application\/ld\+json["']?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
      let movieData = null;
      let seriesData = null;
      let videoObjectData = null;

      for (const block of jsonLdBlocks) {
        try {
          const parsed = JSON.parse(block);
          const type = parsed['@type'];
          if (type === 'Movie') movieData = parsed;
          else if (type === 'TVSeries' || type === 'Series') seriesData = parsed;
          else if (type === 'VideoObject') videoObjectData = parsed;
        } catch {}
      }

      // Extract mediaId from URL or data attribute (e.g. sutjeska_63639890.html -> 63639890)
      let mediaId = null;
      const idMatch = fullUrl.match(/_(\d+)\.html/);
      if (idMatch) mediaId = parseInt(idMatch[1], 10);

      // Fallback year from HTML metadata block (e.g. <div class="metadata mb-12"><span>2021</span>...)
      const htmlYearMatch = html.match(/class=["']?metadata[^"']*["']?>[\s\S]*?<span>(\d{4})<\/span>/i);
      const fallbackYear = htmlYearMatch ? htmlYearMatch[1] : '';

      // Return unified object
      if (movieData) {
        return {
          type: 'movie',
          media_type: 1,
          media_id: mediaId,
          title: movieData.name,
          name: movieData.name,
          url: fullUrl,
          description: movieData.description,
          genre: movieData.genre || [],
          actor: movieData.actor || [],
          director: movieData.director || [],
          duration: movieData.duration,
          year: extractYear(movieData.uploadDate || movieData.trailer?.uploadDate, fallbackYear),
          imageUrl: movieData.image?.url || movieData.image,
          thumbnailUrl: movieData.thumbnailUrl || movieData.trailer?.thumbnailUrl
        };
      }

      if (seriesData) {
        return {
          type: 'series',
          media_type: 2,
          media_id: mediaId,
          title: seriesData.name,
          name: seriesData.name,
          url: fullUrl,
          description: seriesData.description,
          genre: seriesData.genre || [],
          actor: seriesData.actor || [],
          year: extractYear(seriesData.uploadDate || seriesData.trailer?.uploadDate, fallbackYear),
          imageUrl: seriesData.image?.url || seriesData.image,
          thumbnailUrl: seriesData.thumbnailUrl,
          numberOfEpisodes: seriesData.numberOfEpisodes
        };
      }

      if (videoObjectData) {
        return {
          type: 'video',
          media_type: 1,
          media_id: mediaId,
          title: videoObjectData.name,
          name: videoObjectData.name,
          url: fullUrl,
          description: videoObjectData.description,
          duration: videoObjectData.duration,
          year: extractYear(videoObjectData.uploadDate),
          imageUrl: videoObjectData.thumbnailUrl
        };
      }

      return null;
    } catch (err) {
      console.warn(`Error fetching metadata for ${fullUrl}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch all series episodes from its landing page
   */
  async fetchSeriesEpisodes(seriesUrl) {
    let fullUrl = seriesUrl.startsWith('http') ? seriesUrl : `https://voyo.si${seriesUrl.startsWith('/') ? '' : '/'}${seriesUrl}`;
    if (!fullUrl.includes('/vsebina/')) {
      fullUrl = fullUrl.replace(/voyo\.si\//, 'voyo.si/vsebina/');
    }
    try {
      const res = await fetch(fullUrl, { headers: this.headers });
      if (!res.ok) return [];
      const html = await res.text();

      const episodes = [];
      const seenMediaIds = new Set();

      const parseEpisodeBlock = (sourceHtml) => {
        const epRegex = /<a[^>]+data-uniq=["']?(\d+)["']?[^>]+data-season-episode-short=["']?S(\d+)\/E(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = epRegex.exec(sourceHtml)) !== null) {
          const mediaId = parseInt(match[1], 10);
          if (seenMediaIds.has(mediaId)) continue;
          seenMediaIds.add(mediaId);

          const seasonNum = parseInt(match[2], 10);
          const episodeNum = parseInt(match[3], 10);
          const blockHtml = match[4];

          const titleMatch = blockHtml.match(/<h[1-4][^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i);
          const epTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `${episodeNum}. del`;

          const summaryMatch = blockHtml.match(/class=["'][^"']*summary[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
          const epSummary = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : '';

          const imgMatch = blockHtml.match(/src=["']([^"']+)["']/i);
          const epImg = imgMatch ? imgMatch[1] : null;

          episodes.push({
            media_id: mediaId,
            season: seasonNum,
            episode: episodeNum,
            title: epTitle,
            summary: epSummary,
            imageUrl: epImg
          });
        }
      };

      // 1. Parse episodes present on the main landing page
      parseEpisodeBlock(html);

      // 2. Check for multi-season data and category ID (e.g., data-category-id="1041" and data-season="Sezona 2")
      const catIdMatch = html.match(/data-category-id=["']?(\d+)["']?/i);
      const categoryId = catIdMatch ? catIdMatch[1] : null;

      // Extract all season names from data-season-episodes or data-season attributes
      const seasonNames = new Set();
      const seasonEpDataMatch = html.match(/data-season-episodes='([^']+)'/i);
      if (seasonEpDataMatch) {
        try {
          const seasonObj = JSON.parse(seasonEpDataMatch[1]);
          if (Array.isArray(seasonObj)) {
            for (const s of seasonObj) {
              if (s.Season) seasonNames.add(s.Season);
            }
          }
        } catch {}
      }

      // Also check any data-season="Sezona X" elements
      const dataSeasonMatches = [...html.matchAll(/data-season=["']([^"']+)["']/gi)];
      for (const sm of dataSeasonMatches) {
        seasonNames.add(sm[1]);
      }

      // 3. If multiple seasons exist, fetch the episodes for each remaining season
      if (categoryId && seasonNames.size > 0) {
        for (const seasonName of seasonNames) {
          // Check if we already have episodes for this season from the landing page
          const sNumMatch = seasonName.match(/\d+/);
          const sNum = sNumMatch ? parseInt(sNumMatch[0], 10) : null;
          const alreadyHaveSeason = sNum !== null && episodes.some(e => e.season === sNum);

          if (!alreadyHaveSeason) {
            try {
              const seasonUrl = `https://voyo.si/info/voyocategory/${categoryId}/seasons/${encodeURIComponent(seasonName)}/episodes/episodes`;
              const seasonRes = await fetch(seasonUrl, { headers: this.headers });
              if (seasonRes.ok) {
                const seasonHtml = await seasonRes.text();
                parseEpisodeBlock(seasonHtml);
              }
            } catch (err) {
              console.warn(`Error fetching ${seasonName} for ${fullUrl}: ${err.message}`);
            }
          }
        }
      }

      // Sort episodes by season ascending, then episode ascending
      episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
      return episodes;
    } catch (err) {
      console.warn(`Error fetching episodes for ${fullUrl}: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch Voyo catalog items via Homepage and high-volume Sitemaps with in-memory caching
   */
  async fetchCatalog(options = {}) {
    if (this._catalogCache && (Date.now() - (this._catalogCacheTime || 0) < 1800000) && !options.refresh) {
      let cached = this._catalogCache;
      if (options.mediaType === 'movies') cached = cached.filter(i => !i.isSeries);
      else if (options.mediaType === 'shows') cached = cached.filter(i => i.isSeries);
      if (options.limit && options.limit > 0) cached = cached.slice(0, options.limit);
      return cached;
    }

    const items = [];
    const seenUrls = new Set();

    console.log('📡 Fetching Voyo catalog from homepage and sitemaps...');

    // 1. Fetch featured and trending items from homepage ItemList (preserves exact Voyo titles)
    try {
      const res = await fetch('https://voyo.si/', { headers: this.headers });
      if (res.ok) {
        const html = await res.text();
        const jsonLdBlocks = [...html.matchAll(/<script type=["']?application\/ld\+json["']?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
        for (const block of jsonLdBlocks) {
          try {
            const parsed = JSON.parse(block);
            if (parsed['@type'] === 'ItemList' && Array.isArray(parsed.itemListElement)) {
              for (const entry of parsed.itemListElement) {
                const subItem = entry.item;
                if (!subItem || !subItem.url) continue;
                let itemUrl = subItem.url.startsWith('http') ? subItem.url : `https://voyo.si${subItem.url}`;
                if (!itemUrl.includes('/vsebina/')) {
                  itemUrl = itemUrl.replace(/voyo\.si\//, 'voyo.si/vsebina/');
                }
                if (!seenUrls.has(itemUrl)) {
                  seenUrls.add(itemUrl);
                  const isSeries = subItem['@type'] === 'ItemList' || !itemUrl.includes('_');
                  items.push({
                    title: subItem.name,
                    name: subItem.name,
                    url: itemUrl,
                    imageUrl: subItem.image,
                    isSeries
                  });
                }
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`Error loading homepage catalog: ${err.message}`);
    }

    // 2. Fetch comprehensive catalog from high-priority category sitemaps in parallel
    const majorCategorySitemaps = [
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/316', genre: 'Filmi' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/550', genre: 'Drama' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/549', genre: 'Slovenski' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/965', genre: 'Resničnostni šov' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/544', genre: 'Družinski' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/540', genre: 'Komedija' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/1380', genre: 'Kriminalka' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/554', genre: 'Drama' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/5', genre: 'Otroški' },
      { url: 'https://voyo.si/sitemaps/sites/30005/categories/1820', genre: 'Balkanski' }
    ];

    try {
      const sitemapResults = await Promise.all(majorCategorySitemaps.map(async catDef => {
        try {
          const res = await fetch(catDef.url, { headers: this.headers });
          if (!res.ok) return { genre: catDef.genre, entries: [] };
          const xml = await res.text();
          const entries = [];
          const urlBlocks = xml.matchAll(/<url>([\s\S]*?)<\/url>/g);
          for (const block of urlBlocks) {
            const loc = block[1].match(/<loc>([^<]+)<\/loc>/)?.[1];
            const lastmod = block[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
            if (loc) entries.push({ loc, lastmod });
          }
          return { genre: catDef.genre, entries };
        } catch {
          return { genre: catDef.genre, entries: [] };
        }
      }));

      for (const res of sitemapResults) {
        for (const entry of res.entries) {
          const itemLoc = entry.loc;
          if (!itemLoc.includes('/vsebina/')) continue;
          
          if (seenUrls.has(itemLoc)) {
            const existing = items.find(i => i.url === itemLoc);
            if (existing && res.genre && !existing.genres?.includes(res.genre)) {
              if (!existing.genres) existing.genres = [];
              existing.genres.push(res.genre);
            }
            continue;
          }
          seenUrls.add(itemLoc);

          const isSeries = !itemLoc.includes('_');
          const rawSlug = itemLoc.split('/vsebina/')[1]
            .replace(/_\d+\.html$/, '')
            .replace(/\.html$/, '');

          // Check if year is present in slug (e.g. "film-2022") or in lastmod (e.g. "2026-09-18...")
          let year = extractYear(rawSlug);
          if (!year && entry.lastmod) {
            year = extractYear(entry.lastmod);
          }

          const cleanTitle = rawSlug
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

          items.push({
            title: cleanTitle,
            name: cleanTitle,
            url: itemLoc,
            year: year || null,
            isSeries,
            genres: res.genre ? [res.genre] : []
          });
        }
      }
    } catch (err) {
      console.warn(`Error fetching sitemaps: ${err.message}`);
    }

    console.log(`📋 Discovered ${items.length} total Voyo media items (Shows: ${items.filter(i => i.isSeries).length}, Movies: ${items.filter(i => !i.isSeries).length}).`);
    this._catalogCache = items;
    this._catalogCacheTime = Date.now();

    let result = items;
    if (options.mediaType === 'movies') result = result.filter(i => !i.isSeries);
    else if (options.mediaType === 'shows') result = result.filter(i => i.isSeries);
    if (options.limit && options.limit > 0) result = result.slice(0, options.limit);
    return result;
  }
}

// ==========================================
// Sync Engine
// ==========================================
export class SyncEngine {
  constructor(options = {}) {
    this.outputDir = options.outputDir || CONFIG.defaultOutputDir;
    this.moviesDir = options.moviesDir || path.join(this.outputDir, 'MoviesVoyo');
    this.showsDir = options.showsDir || path.join(this.outputDir, 'ShowsVoyo');
    this.bridgeUrl = (options.bridgeUrl || CONFIG.bridgeUrl).replace(/\/+$/, '');
    this.force = options.force || false;
    this.dryRun = options.dryRun || false;
    this.mediaTypeFilter = options.mediaTypeFilter || 'all';
    this.selectedGenres = options.selectedGenres || [];
    this.minYear = options.minYear || null;
    this.minRating = options.minRating || null;
    this.limit = options.limit || null;
    this.languagePreference = options.languagePreference || 'sl';
    this.titleFilter = options.titleFilter || null;

    this.client = new VoyoClient({
      apiUrl: options.apiUrl || CONFIG.apiBaseUrl,
      token: options.authToken || null
    });

    this.stats = {
      moviesCreated: 0,
      episodesCreated: 0,
      itemsSkipped: 0,
      errors: 0
    };
  }

  async init(username = null, password = null, profileId = null) {
    if (username && password) {
      const loginRes = await this.client.login(username, password);
      if (loginRes.success) {
        let targetProfileId = profileId;
        if (!targetProfileId) {
          const profRes = await this.client.getProfiles();
          if (profRes.success && profRes.profiles.length > 0) {
            // Pick normal profile or first profile with subscription
            const pref = profRes.profiles.find(p => p.type === 'normal') || profRes.profiles[0];
            targetProfileId = pref.profileId;
          }
        }
        if (targetProfileId) {
          await this.client.selectProfile(targetProfileId);
        }
      }
    }
  }

  /**
   * Write .strm file with bridge URL
   */
  writeStrmFile(strmPath, streamContent) {
    if (fs.existsSync(strmPath) && !this.force) {
      this.stats.itemsSkipped++;
      return { status: 'skipped', path: strmPath };
    }

    if (!this.dryRun) {
      const dir = path.dirname(strmPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(strmPath, streamContent, 'utf8');
    }

    return { status: 'created', path: strmPath };
  }

  /**
   * Download image helper
   */
  async downloadImage(imageUrl, destPath) {
    if (!imageUrl || fs.existsSync(destPath) && !this.force) return false;
    if (this.dryRun) return true;

    try {
      const res = await fetch(imageUrl, { headers: CONFIG.headers });
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(destPath, buf);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download and convert subtitles for a media item
   */
  async downloadSubtitles(mediaId, baseFilePath) {
    if (this.dryRun || !this.client.token) return;

    try {
      const streamRes = await this.client.getVideoStream(mediaId);
      if (!streamRes.success || !streamRes.url) return;

      // Fetch master m3u8 to extract subtitle URI
      const m3u8Res = await fetch(streamRes.url, { headers: CONFIG.headers });
      if (!m3u8Res.ok) return;
      const m3u8Text = await m3u8Res.text();

      const subMatch = m3u8Text.match(/#EXT-X-MEDIA:TYPE=SUBTITLES[^,\n]*,URI=["']([^"']+)["']/i);
      if (!subMatch) return;

      const subPlaylistUrl = subMatch[1];
      const subRes = await fetch(subPlaylistUrl, { headers: CONFIG.headers });
      if (!subRes.ok) return;
      const subPlaylistText = await subRes.text();

      // Find .vtt file line
      const lines = subPlaylistText.split('\n');
      const vttLine = lines.find(l => l.trim().endsWith('.vtt') || l.includes('.vtt'));
      if (!vttLine) return;

      const fullVttUrl = new URL(vttLine.trim(), subPlaylistUrl).toString();
      const vttRes = await fetch(fullVttUrl, { headers: CONFIG.headers });
      if (!vttRes.ok) return;

      const vttContent = await vttRes.text();
      if (vttContent.includes('WEBVTT')) {
        const vttPath = `${baseFilePath}.sl.vtt`;
        const srtPath = `${baseFilePath}.sl.srt`;

        fs.writeFileSync(vttPath, vttContent, 'utf8');
        const srtContent = vttToSrt(vttContent);
        if (srtContent) {
          fs.writeFileSync(srtPath, srtContent, 'utf8');
        }
      }
    } catch (err) {
      // Subtitle fetch is non-fatal
    }
  }

  /**
   * Process and write movie directory and files
   */
  async processMovie(movieData) {
    try {
      const title = sanitizeName(movieData.name || movieData.title || movieData.media_name || 'Film');
      const year = extractYear(movieData.year || movieData.media_year || movieData.uploadDate, '2024');
      const folderName = `${title} (${year})`;
      const movieDir = path.join(this.moviesDir, folderName);
      const strmPath = path.join(movieDir, `${folderName}.strm`);
      const nfoPath = path.join(movieDir, 'movie.nfo');

      const mediaId = movieData.media_id || movieData.id;
      const streamUrl = `${this.bridgeUrl}/play/${mediaId}`;

      const res = this.writeStrmFile(strmPath, streamUrl);
      if (res.status === 'created') {
        this.stats.moviesCreated++;

        if (!this.dryRun) {
          // Write NFO metadata
          const nfoContent = generateMovieNfo(movieData, folderName);
          fs.writeFileSync(nfoPath, nfoContent, 'utf8');

          // Download Poster & Fanart
          const img = movieData.imageUrl || movieData.image?.url || movieData.thumbnailUrl;
          if (img) {
            await this.downloadImage(img, path.join(movieDir, 'poster.jpg'));
            await this.downloadImage(img, path.join(movieDir, 'fanart.jpg'));
          }

          // Fetch Subtitles
          if (mediaId) {
            await this.downloadSubtitles(mediaId, path.join(movieDir, folderName));
          }
        }
      }
      return res;
    } catch (err) {
      this.stats.errors++;
      console.error(`Error processing movie: ${err.message}`);
      return { status: 'error', message: err.message };
    }
  }

  /**
   * Process and write TV series directory and episodes
   */
  async processShow(showData) {
    try {
      const title = sanitizeName(showData.name || showData.title || showData.series_name || 'Serija');
      const year = extractYear(showData.year || showData.media_year || showData.uploadDate, '2024');
      const folderName = `${title} (${year})`;
      const showDir = path.join(this.showsDir, folderName);
      const nfoPath = path.join(showDir, 'tvshow.nfo');

      if (!this.dryRun) {
        if (!fs.existsSync(showDir)) fs.mkdirSync(showDir, { recursive: true });
        const nfoContent = generateShowNfo(showData, folderName);
        fs.writeFileSync(nfoPath, nfoContent, 'utf8');

        // Download Series Poster & Fanart
        const img = showData.imageUrl || showData.image?.url || showData.thumbnailUrl;
        if (img) {
          await this.downloadImage(img, path.join(showDir, 'poster.jpg'));
          await this.downloadImage(img, path.join(showDir, 'fanart.jpg'));
        }
      }

      // Fetch series episodes from page if URL available
      let episodes = showData.episodes || [];
      if (episodes.length === 0 && showData.url) {
        episodes = await this.client.fetchSeriesEpisodes(showData.url);
      }

      // If mock show without episodes provided, create default episode for testing
      if (episodes.length === 0) {
        episodes = [{
          media_id: showData.media_id || showData.id || 1,
          season: 1,
          episode: 1,
          title: '1. del'
        }];
      }

      for (const ep of episodes) {
        const seasonStr = `Season ${padZero(ep.season)}`;
        const epCode = `S${padZero(ep.season)}E${padZero(ep.episode)}`;
        const epBaseName = `${title} - ${epCode}`;
        const seasonDir = path.join(showDir, seasonStr);
        const epStrmPath = path.join(seasonDir, `${epBaseName}.strm`);

        const streamUrl = `${this.bridgeUrl}/play/${ep.media_id}`;
        const res = this.writeStrmFile(epStrmPath, streamUrl);

        if (res.status === 'created') {
          this.stats.episodesCreated++;
          if (!this.dryRun && ep.media_id) {
            await this.downloadSubtitles(ep.media_id, path.join(seasonDir, epBaseName));
          }
        }
      }

      return { status: 'processed', episodesCount: episodes.length };
    } catch (err) {
      this.stats.errors++;
      console.error(`Error processing show: ${err.message}`);
      return { status: 'error', message: err.message };
    }
  }

  /**
   * Run catalog or targeted series synchronization
   */
  async syncCatalog(onProgress = null) {
    console.log('🚀 Starting Voyo catalog synchronization...');
    let catalogItems = [];

    // If titleFilter is a direct Voyo URL (e.g. https://voyo.si/vsebina/otok-ljubezni-adria)
    if (this.titleFilter && this.titleFilter.startsWith('http')) {
      catalogItems = [{
        url: this.titleFilter,
        name: this.titleFilter.split('/').pop().replace(/-/g, ' '),
        isSeries: true
      }];
    } else {
      catalogItems = await this.client.fetchCatalog({ limit: this.limit });
      if (this.titleFilter) {
        const filterLower = this.titleFilter.toLowerCase().trim();
        catalogItems = catalogItems.filter(item => {
          const t = (item.title || item.name || '').toLowerCase();
          const u = (item.url || '').toLowerCase();
          return t.includes(filterLower) || u.includes(filterLower);
        });
        if (onProgress) onProgress(`🎯 Target filter "${this.titleFilter}" matched ${catalogItems.length} items.`);
      }
    }

    let count = 0;
    for (const item of catalogItems) {
      if (this.limit && count >= this.limit) break;

      try {
        let meta = null;
        if (item.url) {
          meta = await this.client.fetchContentMetadata(item.url);
        }
        if (!meta) meta = item;

        if (meta.type === 'movie' || meta.media_type === 1) {
          if (this.mediaTypeFilter === 'shows') continue;
          if (onProgress) onProgress(`🎬 Processing Movie: ${meta.title || meta.name}`);
          await this.processMovie(meta);
          count++;
        } else {
          if (this.mediaTypeFilter === 'movies') continue;
          if (onProgress) onProgress(`📺 Checking Series: ${meta.title || meta.name}`);
          const prevEpisodesCreated = this.stats.episodesCreated;
          const prevEpisodesSkipped = this.stats.itemsSkipped;
          await this.processShow(meta);
          const newEps = this.stats.episodesCreated - prevEpisodesCreated;
          const skippedEps = this.stats.itemsSkipped - prevEpisodesSkipped;
          if (onProgress) {
            if (newEps > 0) {
              onProgress(`  ✨ Added ${newEps} new episode(s) for "${meta.title || meta.name}"!`);
            } else {
              onProgress(`  ✔️ "${meta.title || meta.name}" is up to date (${skippedEps} existing episodes skipped).`);
            }
          }
          count++;
        }
      } catch (err) {
        this.stats.errors++;
        console.warn(`Failed item sync: ${err.message}`);
      }
    }

    console.log(`\n🎉 Sync Finished! Movies created: ${this.stats.moviesCreated}, Episodes created: ${this.stats.episodesCreated}, Skipped: ${this.stats.itemsSkipped}, Errors: ${this.stats.errors}`);
    return this.stats;
  }
}

// ==========================================
// CLI Execution Entry Point
// ==========================================
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const engine = new SyncEngine(options);
  await engine.init(options.username, options.password, options.profileId);
  await engine.syncCatalog(msg => console.log(msg));
}
