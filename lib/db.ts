import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'studio.db');

// Reuse a single connection across hot reloads in dev
const globalForDb = globalThis as unknown as { __db?: Database.Database };

export const db: Database.Database =
  globalForDb.__db ?? new Database(DB_PATH);

if (!globalForDb.__db) globalForDb.__db = db;

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  whatsapp_number TEXT
);

CREATE TABLE IF NOT EXISTS pricing_configs (
  studio_id TEXT PRIMARY KEY,
  base_rate_per_sq_in REAL NOT NULL,
  placement_multipliers TEXT NOT NULL, -- JSON
  style_multipliers TEXT NOT NULL,     -- JSON
  min_price REAL NOT NULL,
  deposit_percent REAL NOT NULL,
  discount_enabled INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  discount_trigger_hours REAL NOT NULL DEFAULT 24,
  FOREIGN KEY (studio_id) REFERENCES studios(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_name TEXT,
  placement TEXT,
  size_label TEXT,
  style TEXT,
  reference_note TEXT,
  reference_image_url TEXT,
  quoted_price_low REAL,
  quoted_price_high REAL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  follow_up_sent_at TEXT,
  discount_sent_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (studio_id) REFERENCES studios(id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'greeting',
  lead_id TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  UNIQUE(studio_id, client_phone)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'client' | 'bot'
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  slot_time TEXT,
  deposit_status TEXT DEFAULT 'pending',
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
`);

// Safe migrations for existing SQLite databases
const migrations = [
  'ALTER TABLE leads ADD COLUMN reference_image_url TEXT',
  'ALTER TABLE leads ADD COLUMN follow_up_sent_at TEXT',
  'ALTER TABLE leads ADD COLUMN discount_sent_at TEXT',
  'ALTER TABLE pricing_configs ADD COLUMN discount_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE pricing_configs ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0',
  'ALTER TABLE pricing_configs ADD COLUMN discount_trigger_hours REAL NOT NULL DEFAULT 24'
];

for (const migration of migrations) {
  try {
    db.prepare(migration).run();
  } catch {
    // Column already exists, safe to ignore
  }
}

// Seed one demo studio + pricing config if empty
const studioCount = db.prepare('SELECT COUNT(*) as c FROM studios').get() as { c: number };
if (studioCount.c === 0) {
  db.prepare(
    `INSERT INTO studios (id, name, location, whatsapp_number) VALUES (?, ?, ?, ?)`
  ).run('studio_demo', 'Ink & Iron Tattoo Co.', 'Thane, Mumbai', '+91-90000-00000');

  db.prepare(
    `INSERT INTO pricing_configs
     (studio_id, base_rate_per_sq_in, placement_multipliers, style_multipliers, min_price, deposit_percent, discount_enabled, discount_percent, discount_trigger_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'studio_demo',
    350, // ₹ per sq inch base
    JSON.stringify({
      forearm: 1.0,
      bicep: 1.05,
      calf: 1.05,
      back: 1.1,
      chest: 1.15,
      ribs: 1.35,
      neck: 1.4,
      hand: 1.3,
      sleeve: 1.5
    }),
    JSON.stringify({
      fine_line: 1.0,
      minimalist: 0.9,
      traditional: 1.1,
      neo_traditional: 1.2,
      blackwork: 1.15,
      realism: 1.6,
      watercolor: 1.3,
      geometric: 1.1
    }),
    1500, // minimum price for any tattoo, however small
    20, // deposit %
    1, // discount_enabled
    10, // discount_percent: 10%
    24 // discount_trigger_hours: 24h
  );
} else {
  // Ensure existing seed studio has placeholder discount defaults configured
  db.prepare(`
    UPDATE pricing_configs
    SET discount_enabled = 1, discount_percent = 10, discount_trigger_hours = 24
    WHERE studio_id = 'studio_demo' AND (discount_percent IS NULL OR discount_percent = 0)
  `).run();
}

export function getStudio(studioId: string): any {
  return db.prepare('SELECT * FROM studios WHERE id = ?').get(studioId);
}

export function getPricingConfig(studioId: string): any {
  const row: any = db
    .prepare('SELECT * FROM pricing_configs WHERE studio_id = ?')
    .get(studioId);
  if (!row) return null;
  return {
    ...row,
    placement_multipliers: JSON.parse(row.placement_multipliers),
    style_multipliers: JSON.parse(row.style_multipliers),
    discount_enabled: Boolean(row.discount_enabled),
    discount_percent: Number(row.discount_percent ?? 0),
    discount_trigger_hours: Number(row.discount_trigger_hours ?? 24)
  };
}
