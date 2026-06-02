require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '123';
const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE_ENABLED !== 'false';
const DEFAULT_HISTORY_YEARS = Number(process.env.HISTORY_YEARS || 5);
const DEFAULT_LEAGUES = [
  { id: '4480', name: 'UEFA Champions League', enabled: true, country: 'Europe', badge: '' },
  { id: '4328', name: 'English Premier League', enabled: false, country: 'England', badge: '' },
  { id: '4335', name: 'Spanish La Liga', enabled: false, country: 'Spain', badge: '' },
  { id: '4331', name: 'German Bundesliga', enabled: false, country: 'Germany', badge: '' },
  { id: '4332', name: 'Italian Serie A', enabled: false, country: 'Italy', badge: '' },
  { id: '4334', name: 'French Ligue 1', enabled: false, country: 'France', badge: '' }
];

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL mangler. Tilføj Railway PostgreSQL eller lokal Postgres connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '25mb' }));

async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
  for (const league of DEFAULT_LEAGUES) await upsertLeague(league);
}

function result1x2(homeScore, awayScore) {
  if (homeScore === '' || awayScore === '' || homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) return '';
  const h = Number(homeScore); const a = Number(awayScore);
  if (Number.isNaN(h) || Number.isNaN(a)) return '';
  if (h > a) return '1';
  if (h === a) return 'X';
  return '2';
}
function finishedFromEvent(e) {
  const status = String(e.strStatus || e.strProgress || '').toLowerCase();
  return status.includes('match finished') || status === 'ft' || status.includes('finished') || e.intHomeScore !== null || e.intAwayScore !== null;
}

async function upsertLeague(l) {
  await query(`INSERT INTO leagues(id, provider, name, country, badge, enabled, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, country=EXCLUDED.country, badge=EXCLUDED.badge, enabled=EXCLUDED.enabled, updated_at=NOW()`,
    [String(l.id), l.provider || 'thesportsdb', l.name || `League ${l.id}`, l.country || '', l.badge || '', l.enabled !== false]);
}
async function upsertTeam(t) {
  await query(`INSERT INTO teams(id, provider, league_id, league_name, name, short_name, country, badge, logo, jersey, stadium, website, raw, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT(id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, name=EXCLUDED.name, short_name=EXCLUDED.short_name, country=EXCLUDED.country, badge=EXCLUDED.badge, logo=EXCLUDED.logo, jersey=EXCLUDED.jersey, stadium=EXCLUDED.stadium, website=EXCLUDED.website, raw=EXCLUDED.raw, updated_at=NOW()`,
    [String(t.id), t.provider || 'thesportsdb', String(t.leagueId || t.league_id || ''), t.leagueName || t.league_name || '', t.name || '', t.shortName || t.short_name || '', t.country || '', t.badge || '', t.logo || '', t.jersey || '', t.stadium || '', t.website || '', t.raw || null]);
}
async function upsertMatch(m) {
  const r = m.result1x2 || m.result_1x2 || result1x2(m.homeScore ?? m.home_score ?? '', m.awayScore ?? m.away_score ?? '');
  await query(`INSERT INTO matches(id, provider, event_id, league_id, league_name, season, round, date_event, time_event, timestamp, status, venue, home_team_id, away_team_id, home_team, away_team, home_score, away_score, result_1x2, thumb, video, raw, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
    ON CONFLICT(id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, season=EXCLUDED.season, round=EXCLUDED.round, date_event=EXCLUDED.date_event, time_event=EXCLUDED.time_event, timestamp=EXCLUDED.timestamp, status=EXCLUDED.status, venue=EXCLUDED.venue, home_team_id=EXCLUDED.home_team_id, away_team_id=EXCLUDED.away_team_id, home_team=EXCLUDED.home_team, away_team=EXCLUDED.away_team, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, result_1x2=EXCLUDED.result_1x2, thumb=EXCLUDED.thumb, video=EXCLUDED.video, raw=EXCLUDED.raw, updated_at=NOW()`,
    [String(m.id || m.eventId), m.provider || 'thesportsdb', String(m.eventId || m.id), String(m.leagueId || m.league_id || ''), m.leagueName || m.league_name || '', m.season || '', String(m.round || ''), m.dateEvent || m.date_event || null, m.timeEvent || m.time_event || '', m.timestamp || '', m.status || '', m.venue || '', String(m.homeTeamId || m.home_team_id || ''), String(m.awayTeamId || m.away_team_id || ''), m.homeTeam || m.home_team || '', m.awayTeam || m.away_team || '', String(m.homeScore ?? m.home_score ?? ''), String(m.awayScore ?? m.away_score ?? ''), r, m.thumb || '', m.video || '', m.raw || null]);
}

function normalizeEvent(e, league, forcedSeason = '') {
  const homeScore = (e.intHomeScore !== null && e.intHomeScore !== undefined) ? String(e.intHomeScore) : '';
  const awayScore = (e.intAwayScore !== null && e.intAwayScore !== undefined) ? String(e.intAwayScore) : '';
  return {
    id:String(e.idEvent), eventId:String(e.idEvent), provider:'thesportsdb', leagueId:String(league.id), leagueName:league.name || e.strLeague || '',
    season:e.strSeason || forcedSeason || '', round:e.intRound || e.strRound || '', dateEvent:e.dateEvent || null, timeEvent:e.strTime || '', timestamp:e.strTimestamp || '',
    status:e.strStatus || e.strProgress || (finishedFromEvent(e) ? 'Match Finished' : ''), venue:e.strVenue || '',
    homeTeamId:e.idHomeTeam || '', awayTeamId:e.idAwayTeam || '', homeTeam:e.strHomeTeam || '', awayTeam:e.strAwayTeam || '',
    homeScore, awayScore, result1x2: result1x2(homeScore, awayScore), thumb:e.strThumb || '', video:e.strVideo || '', raw:e
  };
}
function normalizeTeam(t, league) {
  return { id:String(t.idTeam), provider:'thesportsdb', leagueId:String(league.id), leagueName:league.name, name:t.strTeam || '', shortName:t.strTeamShort || '', country:t.strCountry || league.country || '', badge:t.strBadge || '', logo:t.strLogo || '', jersey:t.strJersey || '', stadium:t.strStadium || '', website:t.strWebsite || '', raw:t };
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
function getRecentSeasons(years = DEFAULT_HISTORY_YEARS) {
  const now = new Date();
  // European football seasons: after July we are in YYYY-YYYY+1, otherwise previous-current.
  const seasonStartYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: Math.max(1, Number(years) || 5) }, (_, i) => `${seasonStartYear - i}-${seasonStartYear - i + 1}`);
}
async function updateLeague(league) {
  const base = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(THESPORTSDB_API_KEY)}`;
  const [next, past, teams] = await Promise.allSettled([
    fetchJson(`${base}/eventsnextleague.php?id=${encodeURIComponent(league.id)}`),
    fetchJson(`${base}/eventspastleague.php?id=${encodeURIComponent(league.id)}`),
    fetchJson(`${base}/lookup_all_teams.php?id=${encodeURIComponent(league.id)}`)
  ]);
  const events = [];
  if (next.status === 'fulfilled' && Array.isArray(next.value.events)) events.push(...next.value.events.map(e => ({ e, season:'' })));
  if (past.status === 'fulfilled' && Array.isArray(past.value.events)) events.push(...past.value.events.map(e => ({ e, season:'' })));
  const normalizedTeams = teams.status === 'fulfilled' && Array.isArray(teams.value.teams) ? teams.value.teams.map(t => normalizeTeam(t, league)) : [];
  const normalizedMatches = events.map(x => normalizeEvent(x.e, league, x.season));
  for (const team of normalizedTeams) await upsertTeam(team);
  for (const match of normalizedMatches) await upsertMatch(match);
  return { league: league.name, teams: normalizedTeams.length, matches: normalizedMatches.length };
}
async function updateLeagueHistory(league, years = DEFAULT_HISTORY_YEARS) {
  const run = await query(`INSERT INTO sync_runs(run_type, league_id, status, message) VALUES('history', $1, 'running', $2) RETURNING id`, [String(league.id), `${league.name}: starter historik`]);
  const runId = run.rows[0].id;
  const base = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(THESPORTSDB_API_KEY)}`;
  const seasons = getRecentSeasons(years);
  let matchCount = 0;
  let teamCount = 0;
  try {
    const teams = await fetchJson(`${base}/lookup_all_teams.php?id=${encodeURIComponent(league.id)}`).catch(() => ({ teams: [] }));
    const normalizedTeams = Array.isArray(teams.teams) ? teams.teams.map(t => normalizeTeam(t, league)) : [];
    for (const team of normalizedTeams) await upsertTeam(team);
    teamCount += normalizedTeams.length;
    for (const season of seasons) {
      const data = await fetchJson(`${base}/eventsseason.php?id=${encodeURIComponent(league.id)}&s=${encodeURIComponent(season)}`).catch(err => ({ events: [], _error: err.message }));
      const events = Array.isArray(data.events) ? data.events : [];
      const normalizedMatches = events.map(e => normalizeEvent(e, league, season));
      for (const match of normalizedMatches) await upsertMatch(match);
      matchCount += normalizedMatches.length;
    }
    await query(`UPDATE sync_runs SET finished_at=NOW(), status='ok', message=$1, inserted_matches=$2, inserted_teams=$3 WHERE id=$4`, [`${league.name}: ${seasons.join(', ')}`, matchCount, teamCount, runId]);
    return { league: league.name, seasons, teams: teamCount, matches: matchCount };
  } catch (err) {
    await query(`UPDATE sync_runs SET finished_at=NOW(), status='error', message=$1, inserted_matches=$2, inserted_teams=$3 WHERE id=$4`, [err.message, matchCount, teamCount, runId]);
    throw err;
  }
}
async function updateAllActiveLeagues() {
  const { rows } = await query('SELECT id, name, country, badge, enabled FROM leagues WHERE enabled = TRUE ORDER BY name');
  const results = [];
  for (const league of rows) {
    try { results.push(await updateLeague(league)); }
    catch (err) { results.push({ league: league.name, error: err.message }); }
  }
  return results;
}
async function updateAllHistory(years = DEFAULT_HISTORY_YEARS) {
  const { rows } = await query('SELECT id, name, country, badge, enabled FROM leagues WHERE enabled = TRUE ORDER BY name');
  const results = [];
  for (const league of rows) {
    try { results.push(await updateLeagueHistory(league, years)); }
    catch (err) { results.push({ league: league.name, error: err.message }); }
  }
  return results;
}


function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function decimalOdds(probability) {
  if (!probability || probability <= 0) return 0;
  return Number((1 / probability).toFixed(2));
}
function buildOddsFromCounts({ total, teamAWins, draws, teamBWins, margin = 7, minSample = 6 }) {
  const safeTotal = Math.max(0, Number(total || 0));
  const m = clampNumber(margin, 0, 40, 7) / 100;
  const min = Math.max(1, Number(minSample || 6));
  // Laplace smoothing: avoids silly 1.00 or infinity odds when sample is small.
  const aBase = Number(teamAWins || 0) + 1;
  const xBase = Number(draws || 0) + 1;
  const bBase = Number(teamBWins || 0) + 1;
  const baseTotal = safeTotal + 3;
  const fair = {
    one: aBase / baseTotal,
    x: xBase / baseTotal,
    two: bBase / baseTotal
  };
  const withMargin = {
    one: fair.one * (1 + m),
    x: fair.x * (1 + m),
    two: fair.two * (1 + m)
  };
  const confidence = safeTotal >= min ? 'good' : (safeTotal >= Math.ceil(min / 2) ? 'medium' : 'low');
  const pick = [
    { key:'1', label:'Hold A', prob:fair.one },
    { key:'X', label:'Uafgjort', prob:fair.x },
    { key:'2', label:'Hold B', prob:fair.two }
  ].sort((a,b) => b.prob - a.prob)[0];
  return {
    total: safeTotal,
    counts: { one:Number(teamAWins || 0), x:Number(draws || 0), two:Number(teamBWins || 0) },
    marginPercent: Number((m * 100).toFixed(2)),
    confidence,
    suggestedPick: pick.key,
    probabilities: {
      one: Number((fair.one * 100).toFixed(1)),
      x: Number((fair.x * 100).toFixed(1)),
      two: Number((fair.two * 100).toFixed(1))
    },
    fairOdds: {
      one: decimalOdds(fair.one),
      x: decimalOdds(fair.x),
      two: decimalOdds(fair.two)
    },
    bookOdds: {
      one: decimalOdds(withMargin.one),
      x: decimalOdds(withMargin.x),
      two: decimalOdds(withMargin.two)
    }
  };
}

function parseBoolFinishedWhere() {
  return `(home_score IS NOT NULL AND away_score IS NOT NULL AND home_score <> '' AND away_score <> '')`;
}

function matchSelectSql() {
  return `SELECT id, provider, event_id as "eventId", league_id as "leagueId", league_name as "leagueName", season, round, date_event as "dateEvent", time_event as "timeEvent", timestamp, status, venue, home_team_id as "homeTeamId", away_team_id as "awayTeamId", home_team as "homeTeam", away_team as "awayTeam", home_score as "homeScore", away_score as "awayScore", result_1x2 as "result1x2", thumb, video, raw FROM matches`;
}
function h2hStats(rows, teamA, teamB) {
  const stats = { teamA, teamB, total:0, teamAWins:0, draws:0, teamBWins:0, latest:null, rows:[] };
  for (const m of rows) {
    const h = Number(m.homeScore); const a = Number(m.awayScore);
    if (Number.isNaN(h) || Number.isNaN(a)) continue;
    stats.total += 1;
    let winner = 'X';
    if (h > a) winner = String(m.homeTeam).toLowerCase() === teamA.toLowerCase() ? 'A' : 'B';
    if (h < a) winner = String(m.awayTeam).toLowerCase() === teamA.toLowerCase() ? 'A' : 'B';
    if (winner === 'A') stats.teamAWins += 1;
    else if (winner === 'B') stats.teamBWins += 1;
    else stats.draws += 1;
    stats.rows.push({ ...m, winner });
  }
  stats.latest = stats.rows[0] || null;
  return stats;
}

app.get('/health', (_req, res) => res.json({ ok:true, app:'Football Result Register API', version:'0.5.0', time:new Date().toISOString() }));
app.get('/api/register', async (_req, res, next) => {
  try {
    const leagues = (await query('SELECT id, provider, name, country, badge, enabled FROM leagues ORDER BY name')).rows.map(r => ({ id:r.id, provider:r.provider, name:r.name, country:r.country, badge:r.badge, enabled:r.enabled }));
    const teams = (await query('SELECT id, provider, league_id as "leagueId", league_name as "leagueName", name, short_name as "shortName", country, badge, logo, jersey, stadium, website, raw FROM teams ORDER BY name')).rows;
    const matches = (await query('SELECT id, provider, event_id as "eventId", league_id as "leagueId", league_name as "leagueName", season, round, date_event as "dateEvent", time_event as "timeEvent", timestamp, status, venue, home_team_id as "homeTeamId", away_team_id as "awayTeamId", home_team as "homeTeam", away_team as "awayTeam", home_score as "homeScore", away_score as "awayScore", result_1x2 as "result1x2", thumb, video, raw FROM matches ORDER BY date_event DESC NULLS LAST, time_event DESC LIMIT 25000')).rows;
    res.json({ leagues, teams, matches });
  } catch (err) { next(err); }
});
app.post('/api/sync/push', async (req, res, next) => {
  try {
    const leagues = req.body.leagues || [];
    const teams = req.body.teams || [];
    const matches = req.body.matches || [];
    for (const league of leagues) await upsertLeague(league);
    for (const team of teams) await upsertTeam(team);
    for (const match of matches) await upsertMatch(match);
    res.json({ ok:true, leagues:leagues.length, teams:teams.length, matches:matches.length });
  } catch (err) { next(err); }
});
app.post('/api/admin/update-all', async (_req, res, next) => {
  try { res.json({ ok:true, results: await updateAllActiveLeagues() }); }
  catch (err) { next(err); }
});
app.get('/api/admin/update-all', async (_req, res, next) => {
  try { res.json({ ok:true, results: await updateAllActiveLeagues() }); }
  catch (err) { next(err); }
});
app.post('/api/admin/update-history', async (req, res, next) => {
  try { res.json({ ok:true, years:Number(req.query.years || req.body?.years || DEFAULT_HISTORY_YEARS), results: await updateAllHistory(Number(req.query.years || req.body?.years || DEFAULT_HISTORY_YEARS)) }); }
  catch (err) { next(err); }
});
app.get('/api/admin/update-history', async (req, res, next) => {
  try { res.json({ ok:true, years:Number(req.query.years || DEFAULT_HISTORY_YEARS), results: await updateAllHistory(Number(req.query.years || DEFAULT_HISTORY_YEARS)) }); }
  catch (err) { next(err); }
});
app.get('/api/h2h', async (req, res, next) => {
  try {
    const teamA = String(req.query.teamA || '').trim();
    const teamB = String(req.query.teamB || '').trim();
    const years = Math.max(1, Math.min(30, Number(req.query.years || DEFAULT_HISTORY_YEARS)));
    const leagueId = String(req.query.leagueId || 'all');
    if (!teamA || !teamB) return res.status(400).json({ error:'teamA and teamB are required' });
    const params = [teamA, teamB, `${years} years`];
    let leagueFilter = '';
    if (leagueId !== 'all') { params.push(leagueId); leagueFilter = `AND league_id = $4`; }
    const sql = `SELECT id, provider, event_id as "eventId", league_id as "leagueId", league_name as "leagueName", season, round, date_event as "dateEvent", time_event as "timeEvent", status, venue, home_team_id as "homeTeamId", away_team_id as "awayTeamId", home_team as "homeTeam", away_team as "awayTeam", home_score as "homeScore", away_score as "awayScore", result_1x2 as "result1x2", thumb, video
      FROM matches
      WHERE ${parseBoolFinishedWhere()}
      AND date_event >= (CURRENT_DATE - $3::interval)
      ${leagueFilter}
      AND ((LOWER(home_team)=LOWER($1) AND LOWER(away_team)=LOWER($2)) OR (LOWER(home_team)=LOWER($2) AND LOWER(away_team)=LOWER($1)))
      ORDER BY date_event DESC NULLS LAST, time_event DESC`;
    const rows = (await query(sql, params)).rows;
    res.json({ ok:true, years, leagueId, ...h2hStats(rows, teamA, teamB) });
  } catch (err) { next(err); }
});
app.get('/api/h2h/top', async (req, res, next) => {
  try {
    const years = Math.max(1, Math.min(30, Number(req.query.years || DEFAULT_HISTORY_YEARS)));
    const limit = Math.max(5, Math.min(200, Number(req.query.limit || 50)));
    const leagueId = String(req.query.leagueId || 'all');
    const params = [`${years} years`, limit];
    let leagueFilter = '';
    if (leagueId !== 'all') { params.push(leagueId); leagueFilter = `AND league_id = $3`; }
    const { rows } = await query(`WITH normalized AS (
      SELECT
        LEAST(LOWER(home_team), LOWER(away_team)) AS a_key,
        GREATEST(LOWER(home_team), LOWER(away_team)) AS b_key,
        MIN(CASE WHEN LOWER(home_team) <= LOWER(away_team) THEN home_team ELSE away_team END) AS team_a,
        MIN(CASE WHEN LOWER(home_team) <= LOWER(away_team) THEN away_team ELSE home_team END) AS team_b,
        COUNT(*) AS games
      FROM matches
      WHERE ${parseBoolFinishedWhere()} AND date_event >= (CURRENT_DATE - $1::interval) ${leagueFilter}
      GROUP BY LEAST(LOWER(home_team), LOWER(away_team)), GREATEST(LOWER(home_team), LOWER(away_team))
    ) SELECT team_a as "teamA", team_b as "teamB", games FROM normalized WHERE games >= 2 ORDER BY games DESC, team_a LIMIT $2`, params);
    res.json({ ok:true, years, leagueId, pairs: rows });
  } catch (err) { next(err); }
});

app.get('/api/odds/h2h', async (req, res, next) => {
  try {
    const teamA = String(req.query.teamA || '').trim();
    const teamB = String(req.query.teamB || '').trim();
    const years = Math.max(1, Math.min(30, Number(req.query.years || DEFAULT_HISTORY_YEARS)));
    const leagueId = String(req.query.leagueId || 'all');
    const margin = clampNumber(req.query.margin, 0, 40, 7);
    const minSample = clampNumber(req.query.minSample, 1, 100, 6);
    if (!teamA || !teamB) return res.status(400).json({ error:'teamA and teamB are required' });
    const params = [teamA, teamB, `${years} years`];
    let leagueFilter = '';
    if (leagueId !== 'all') { params.push(leagueId); leagueFilter = `AND league_id = $4`; }
    const sql = `SELECT id, provider, event_id as "eventId", league_id as "leagueId", league_name as "leagueName", season, round, date_event as "dateEvent", time_event as "timeEvent", status, venue, home_team_id as "homeTeamId", away_team_id as "awayTeamId", home_team as "homeTeam", away_team as "awayTeam", home_score as "homeScore", away_score as "awayScore", result_1x2 as "result1x2", thumb, video
      FROM matches
      WHERE ${parseBoolFinishedWhere()}
      AND date_event >= (CURRENT_DATE - $3::interval)
      ${leagueFilter}
      AND ((LOWER(home_team)=LOWER($1) AND LOWER(away_team)=LOWER($2)) OR (LOWER(home_team)=LOWER($2) AND LOWER(away_team)=LOWER($1)))
      ORDER BY date_event DESC NULLS LAST, time_event DESC`;
    const rows = (await query(sql, params)).rows;
    const stats = h2hStats(rows, teamA, teamB);
    const odds = buildOddsFromCounts({ total:stats.total, teamAWins:stats.teamAWins, draws:stats.draws, teamBWins:stats.teamBWins, margin, minSample });
    res.json({ ok:true, years, leagueId, teamA, teamB, stats, odds });
  } catch (err) { next(err); }
});


app.get('/api/matches/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const leagueId = String(req.query.leagueId || 'all');
    const status = String(req.query.status || 'finished');
    const years = Math.max(1, Math.min(30, Number(req.query.years || DEFAULT_HISTORY_YEARS)));
    const limit = Math.max(10, Math.min(500, Number(req.query.limit || 200)));
    const where = [];
    const params = [];
    params.push(`${years} years`);
    where.push(`date_event >= (CURRENT_DATE - $${params.length}::interval)`);
    if (leagueId !== 'all') { params.push(leagueId); where.push(`league_id = $${params.length}`); }
    if (status === 'finished') where.push(parseBoolFinishedWhere());
    if (status === 'upcoming') where.push(`NOT ${parseBoolFinishedWhere()}`);
    if (q) {
      params.push(`%${q}%`);
      where.push(`(home_team ILIKE $${params.length} OR away_team ILIKE $${params.length} OR league_name ILIKE $${params.length} OR season ILIKE $${params.length} OR round ILIKE $${params.length} OR venue ILIKE $${params.length} OR status ILIKE $${params.length})`);
    }
    params.push(limit);
    const sql = `${matchSelectSql()} WHERE ${where.join(' AND ')} ORDER BY date_event DESC NULLS LAST, time_event DESC LIMIT $${params.length}`;
    const rows = (await query(sql, params)).rows;
    res.json({ ok:true, count:rows.length, matches:rows });
  } catch (err) { next(err); }
});

app.get('/api/matches/upcoming', async (req, res, next) => {
  try {
    const leagueId = String(req.query.leagueId || 'all');
    const limit = Math.max(5, Math.min(200, Number(req.query.limit || 50)));
    const where = [`NOT ${parseBoolFinishedWhere()}`];
    const params = [];
    if (leagueId !== 'all') { params.push(leagueId); where.push(`league_id = $${params.length}`); }
    params.push(limit);
    const sql = `${matchSelectSql()} WHERE ${where.join(' AND ')} ORDER BY date_event ASC NULLS LAST, time_event ASC LIMIT $${params.length}`;
    const rows = (await query(sql, params)).rows;
    res.json({ ok:true, count:rows.length, matches:rows });
  } catch (err) { next(err); }
});

app.get('/api/matches/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM matches WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Football Register API v0.5 kører på port ${PORT}`));
  if (AUTO_UPDATE_ENABLED) {
    cron.schedule('0 * * * *', async () => {
      console.log('Cron: opdaterer alle aktive ligaer...');
      try { console.log(await updateAllActiveLeagues()); }
      catch (err) { console.error('Cron error:', err); }
    });
    cron.schedule('15 3 * * *', async () => {
      console.log('Cron: opdaterer historik...');
      try { console.log(await updateAllHistory(DEFAULT_HISTORY_YEARS)); }
      catch (err) { console.error('History cron error:', err); }
    });
  }
}).catch(err => {
  console.error('Kunne ikke starte backend:', err);
  process.exit(1);
});
