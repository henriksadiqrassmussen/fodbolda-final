CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'thesportsdb',
  name TEXT NOT NULL,
  country TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  enabled BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'thesportsdb',
  league_id TEXT DEFAULT '',
  league_name TEXT DEFAULT '',
  name TEXT NOT NULL,
  short_name TEXT DEFAULT '',
  country TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  jersey TEXT DEFAULT '',
  stadium TEXT DEFAULT '',
  website TEXT DEFAULT '',
  raw JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'thesportsdb',
  event_id TEXT NOT NULL,
  league_id TEXT DEFAULT '',
  league_name TEXT DEFAULT '',
  season TEXT DEFAULT '',
  round TEXT DEFAULT '',
  date_event DATE,
  time_event TEXT DEFAULT '',
  timestamp TEXT DEFAULT '',
  status TEXT DEFAULT '',
  venue TEXT DEFAULT '',
  home_team_id TEXT DEFAULT '',
  away_team_id TEXT DEFAULT '',
  home_team TEXT DEFAULT '',
  away_team TEXT DEFAULT '',
  home_score TEXT DEFAULT '',
  away_score TEXT DEFAULT '',
  result_1x2 TEXT DEFAULT '',
  thumb TEXT DEFAULT '',
  video TEXT DEFAULT '',
  raw JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  league_id TEXT DEFAULT '',
  season TEXT DEFAULT '',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  message TEXT DEFAULT '',
  inserted_matches INTEGER DEFAULT 0,
  inserted_teams INTEGER DEFAULT 0
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS result_1x2 TEXT DEFAULT '';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS raw JSONB;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS raw JSONB;

CREATE INDEX IF NOT EXISTS idx_matches_league_date ON matches(league_id, date_event DESC);
CREATE INDEX IF NOT EXISTS idx_matches_home_away ON matches(home_team_id, away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_home_away_names ON matches(LOWER(home_team), LOWER(away_team));
CREATE INDEX IF NOT EXISTS idx_matches_result_1x2 ON matches(result_1x2);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(LOWER(name));
