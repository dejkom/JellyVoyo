import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sanitizeName,
  padZero,
  extractYear,
  parseDuration,
  vttToSrt,
  generateMovieNfo,
  generateShowNfo,
  convertAllVttInDirectory,
  SyncEngine,
  VoyoClient
} from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testMediaDir = path.join(__dirname, 'test_media');

// Test 1: String Sanitization & Year Extraction
console.log('🧪 Testing sanitization & duration parsing...');
assert.strictEqual(sanitizeName('Alien: Romulus (2024) / Special * <Cut>?'), 'Alien Romulus (2024) Special Cut');
assert.strictEqual(sanitizeName('Ja, Chef! / Season 1 | Episode 1'), 'Ja, Chef! Season 1 Episode 1');
assert.strictEqual(sanitizeName('‌​​​‌​‌​​‌​​​​‌‌​​Sutjeska'), 'Sutjeska');
assert.strictEqual(padZero(3), '03');
assert.strictEqual(padZero(12), '12');
assert.strictEqual(extractYear('2026-08-31T10:45:03+02:00'), '2026');
assert.strictEqual(extractYear(1973), '1973');
assert.strictEqual(parseDuration('PT2H3M38S'), 123);
assert.strictEqual(parseDuration('PT45M'), 45);

// Test 2: VTT to SRT Conversion
console.log('🧪 Testing VTT to SRT conversion...');
const sampleVtt = `WEBVTT
Kind: captions
Language: sl

NOTE Test comment

00:00:01.500 --> 00:00:04.200
<v Narrator>Pozdravljen svet!</v>

00:00:05.100 --> 00:00:08.750
<c.yellow>To je druga vrstica podnapisov.</c>
Z dodatnim besedilom.
`;

const convertedSrt = vttToSrt(sampleVtt);
assert(convertedSrt.includes('1\n00:00:01,500 --> 00:00:04,200\nPozdravljen svet!'), 'First cue must be converted accurately');
assert(convertedSrt.includes('2\n00:00:05,100 --> 00:00:08,750\nTo je druga vrstica podnapisov.\nZ dodatnim besedilom.'), 'Second cue must be converted accurately');
console.log('  ✅ VTT to SRT converted accurately without tags');

// Test 3: NFO XML Generation (Voyo schema with actors, genres, duration)
console.log('🧪 Testing NFO XML generation...');
const sampleVoyoMovie = {
  media_id: 63639890,
  name: 'Sutjeska',
  description: 'Zgodovinski film o bitki na Neretvi in Sutjeski.',
  year: 1973,
  rating: 7.8,
  genre: ['Drama', 'Vojni'],
  director: [{ name: 'Stipe Delić' }],
  actor: [{ name: 'Richard Burton' }, { name: 'Velimir Bata Živojinović' }],
  duration: 'PT2H3M38S'
};

const movieNfo = generateMovieNfo(sampleVoyoMovie, 'Sutjeska (1973)');
assert(movieNfo.includes('<title>Sutjeska (1973)</title>'), 'NFO title must match');
assert(movieNfo.includes('<plot>Zgodovinski film o bitki na Neretvi in Sutjeski.</plot>'), 'NFO plot must match');
assert(movieNfo.includes('<year>1973</year>'), 'NFO year must match');
assert(movieNfo.includes('<genre>Drama</genre>'), 'NFO genre must match');
assert(movieNfo.includes('<director>Stipe Delić</director>'), 'NFO director must match');
assert(movieNfo.includes('<name>Richard Burton</name>'), 'NFO actor must match');
assert(movieNfo.includes('<runtime>123</runtime>'), 'NFO runtime must match');
console.log('  ✅ movie.nfo generated with all Voyo fields');

// Clean test media dir
if (fs.existsSync(testMediaDir)) {
  fs.rmSync(testMediaDir, { recursive: true, force: true });
}

// Test 4: Sync Engine Processing Movies and Shows with .nfo generation
console.log('🧪 Testing Movie and Series directory generation...');
const engine = new SyncEngine({
  outputDir: testMediaDir,
  moviesDir: path.join(testMediaDir, 'MoviesVoyo'),
  showsDir: path.join(testMediaDir, 'ShowsVoyo'),
  bridgeUrl: 'http://localhost:3851',
  force: false,
  dryRun: false
});

// Process Movie
await engine.processMovie({
  media_id: 63639890,
  name: 'Sutjeska',
  description: 'Legendarni vojni film.',
  year: 1973,
  rating: 7.8
});

const movieDir = path.join(testMediaDir, 'MoviesVoyo', 'Sutjeska (1973)');
const movieStrmPath = path.join(movieDir, 'Sutjeska (1973).strm');
const movieNfoPath = path.join(movieDir, 'movie.nfo');

assert(fs.existsSync(movieStrmPath), `Movie file should exist at ${movieStrmPath}`);
assert(fs.existsSync(movieNfoPath), `Movie NFO file should exist at ${movieNfoPath}`);
const movieContent = fs.readFileSync(movieStrmPath, 'utf8').trim();
assert.strictEqual(movieContent, 'http://localhost:3851/play/63639890');
console.log('  ✅ movie.strm and movie.nfo created successfully');

// Process Series with Episodes
await engine.processShow({
  name: 'Ja, Chef!',
  description: 'Humoristična serija.',
  year: 2021,
  episodes: [
    { media_id: 63301688, season: 1, episode: 1, title: '1. del' },
    { media_id: 63301689, season: 1, episode: 2, title: '2. del' }
  ]
});

const showDir = path.join(testMediaDir, 'ShowsVoyo', 'Ja, Chef! (2021)');
const showStrmPath1 = path.join(showDir, 'Season 01', 'Ja, Chef! - S01E01.strm');
const showStrmPath2 = path.join(showDir, 'Season 01', 'Ja, Chef! - S01E02.strm');
const showNfoPath = path.join(showDir, 'tvshow.nfo');

assert(fs.existsSync(showStrmPath1), `Show ep 1 file should exist at ${showStrmPath1}`);
assert(fs.existsSync(showStrmPath2), `Show ep 2 file should exist at ${showStrmPath2}`);
assert(fs.existsSync(showNfoPath), `Show NFO file should exist at ${showNfoPath}`);
console.log('  ✅ show.strm and tvshow.nfo created successfully');

// Test 5: Mass Subtitle Conversion in Directory
console.log('🧪 Testing convertAllVttInDirectory...');
const testSubVtt = path.join(movieDir, 'test_sub.vtt');
fs.writeFileSync(testSubVtt, sampleVtt, 'utf8');

const convStats = convertAllVttInDirectory(testMediaDir, false);
assert.strictEqual(convStats.converted, 1, 'Should convert 1 VTT file');
const testSubSrt = path.join(movieDir, 'test_sub.srt');
assert(fs.existsSync(testSubSrt), 'Converted .srt file should exist');
console.log('  ✅ Mass conversion successfully produced .srt beside .vtt');

// Test 6: Idempotency (Skip existing)
console.log('🧪 Testing idempotency / skip existing...');
const skipRes = engine.writeStrmFile(movieStrmPath, 'new-content');
assert.strictEqual(skipRes.status, 'skipped');

// Clean up test media dir
fs.rmSync(testMediaDir, { recursive: true, force: true });

console.log('\n🎉 ALL JellyVoyo unit and integration tests passed successfully!');
