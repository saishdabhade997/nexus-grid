require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixScheduler() {
    try {
        console.log("🔧 Creating missing scheduler table...");

        const sql = `
        CREATE TABLE IF NOT EXISTS rescheduler_settings (
            id SERIAL PRIMARY KEY,
            section VARCHAR(50) UNIQUE NOT NULL,
            email_enabled BOOLEAN DEFAULT FALSE,
            email VARCHAR(255),
            schedule_date DATE,
            schedule_time TIME,
            frequency VARCHAR(20) DEFAULT 'monthly',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        `;

        await pool.query(sql);
        console.log("✅ SUCCESS: 'rescheduler_settings' table created!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
}

fixScheduler();
