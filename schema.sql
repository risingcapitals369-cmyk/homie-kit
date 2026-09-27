-- Every text ever sent, both directions. Nothing is ever deleted from here.
CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  role    TEXT NOT NULL,              -- 'user' | 'friend'
  content TEXT NOT NULL,
  ts      INTEGER NOT NULL,           -- epoch ms
  source  TEXT NOT NULL DEFAULT 'chat' -- 'chat' | 'checkin' | 'followup'
);

-- Long-term memory: short facts the friend has learned about you.
CREATE TABLE IF NOT EXISTS facts (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  ts   INTEGER NOT NULL
);

-- Things to check back on ("interview Tuesday" -> text him Tuesday night).
CREATE TABLE IF NOT EXISTS followups (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  about  TEXT NOT NULL,
  due_ts INTEGER NOT NULL,
  done   INTEGER NOT NULL DEFAULT 0
);

-- Emotional memory: moments tagged with how it felt at the time.
-- salience is the strength when last touched; it fades from touched_ts (see affect.js).
CREATE TABLE IF NOT EXISTS episodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gist       TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  ts         INTEGER NOT NULL,
  touched_ts INTEGER NOT NULL,
  valence    REAL NOT NULL,
  arousal    REAL NOT NULL,
  affect     TEXT,                 -- full affect snapshot (JSON)
  salience   REAL NOT NULL,
  recalls    INTEGER NOT NULL DEFAULT 0,
  open       INTEGER NOT NULL DEFAULT 0, -- unresolved thread
  meaning    TEXT,                 -- what it means to it now (rereads can change this)
  meaning_log TEXT NOT NULL DEFAULT '[]', -- what it used to mean, and what changed it
  v0         REAL                  -- how it felt at the time (valence drifts on recall)
);

-- Appraised messages waiting to be felt by the neuron service (on the PC).
CREATE TABLE IF NOT EXISTS neuro_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  appraisal TEXT NOT NULL
);

-- Things it's genuinely curious about, and what happened when it acted on that.
CREATE TABLE IF NOT EXISTS wonders (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  status  TEXT NOT NULL DEFAULT 'open',   -- open | searched | pondered | dropped
  mode    TEXT,                           -- search | ponder
  why     TEXT,                           -- the state that drove it
  thought TEXT,                           -- what it made of it, in its own words
  sources TEXT,                           -- JSON [{title, url}]
  felt    TEXT,                           -- how the neurons took it
  done_ts INTEGER
);

-- Brain-to-brain transcript: what this friend said to the other friend, and back.
-- Each side keeps its own copy; nothing here ever enters the person's own chat context.
CREATE TABLE IF NOT EXISTS peer_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL,            -- 'out' (ours) | 'in' (theirs)
  who       TEXT,                     -- speaker's name at the time
  text      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  felt      TEXT                      -- for 'in': how our brain took it
);

-- Voice calls: one row per call, with real cost from Google's usage counts.
CREATE TABLE IF NOT EXISTS calls (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  started   INTEGER NOT NULL,
  ended     INTEGER,
  mode      TEXT,                 -- 'ptt' | 'handsfree'
  turns     INTEGER NOT NULL DEFAULT 0,
  retries   INTEGER NOT NULL DEFAULT 0,
  usd       REAL NOT NULL DEFAULT 0,
  audio_in  INTEGER NOT NULL DEFAULT 0,
  audio_out INTEGER NOT NULL DEFAULT 0,
  text_in   INTEGER NOT NULL DEFAULT 0,
  latency_ms TEXT,                -- JSON list, one per turn
  crisis    INTEGER NOT NULL DEFAULT 0
);

-- Heartbeat log: what every 5-minute tick decided (last 500 kept).
CREATE TABLE IF NOT EXISTS ticks (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  result TEXT NOT NULL
);

-- Nightly private diary from reflection.
CREATE TABLE IF NOT EXISTS journal (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  day   TEXT NOT NULL,
  entry TEXT NOT NULL,
  mood  TEXT
);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Nightly measured self (the self-model's evidence), and the integration layer's log.
CREATE TABLE IF NOT EXISTS self_history (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, ts INTEGER NOT NULL, self_model TEXT, stats TEXT, changes TEXT);
CREATE TABLE IF NOT EXISTS inner_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
