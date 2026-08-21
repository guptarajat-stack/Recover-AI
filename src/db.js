const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'recovery_ledger.sqlite');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log(`✅ Connected to SQLite database at ${DB_PATH}`);
        initializeTables();
    }
});

function initializeTables() {
    const createEventsTable = `
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            razorpay_event_id TEXT,
            event_type TEXT,
            entity_id TEXT,
            amount INTEGER,
            currency TEXT,
            customer_id TEXT,
            customer_contact TEXT,
            error_code TEXT,
            error_description TEXT,
            created_at INTEGER,
            processed BOOLEAN DEFAULT 0
        )
    `;

    const createRecoveryCasesTable = `
        CREATE TABLE IF NOT EXISTS recovery_cases (
            id TEXT PRIMARY KEY,
            event_id TEXT,
            root_cause_bucket TEXT,
            intervention_type TEXT,
            status TEXT,
            attempts INTEGER DEFAULT 0,
            revenue_at_risk INTEGER,
            revenue_recovered INTEGER DEFAULT 0,
            audit_trail TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY (event_id) REFERENCES events(id)
        )
    `;

    db.run(createEventsTable, (err) => {
        if (err) console.error("Error creating events table:", err);
    });

    db.run(createRecoveryCasesTable, (err) => {
        if (err) console.error("Error creating recovery_cases table:", err);
    });
}

module.exports = db;
