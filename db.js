const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.RENDER ? '/tmp/app.db' : path.join(__dirname, '..', 'data', 'app.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thang TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'uploaded',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filetype TEXT NOT NULL,
            extracted_text TEXT,
            FOREIGN KEY (batch_id) REFERENCES batches(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL UNIQUE,
            draft_json TEXT NOT NULL,
            confirmed_json TEXT,
            report_path TEXT,
            FOREIGN KEY (batch_id) REFERENCES batches(id)
        );
    `);
});

module.exports = db;
