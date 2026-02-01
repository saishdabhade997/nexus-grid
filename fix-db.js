require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixDatabase() {
    try {
        console.log("🔧 Fixing Database...");

        // 1. Add the missing 'total_units_consumed' column to users table
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS total_units_consumed NUMERIC DEFAULT 0;
        `);
        console.log("✅ Added column: total_units_consumed");

        // 2. Add 'monthly_bill' too (just in case the code asks for it next)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS monthly_bill NUMERIC DEFAULT 0;
        `);
        console.log("✅ Added column: monthly_bill");

        console.log("🎉 Database Fix Complete!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error fixing database:", err);
        process.exit(1);
    }
}

fixDatabase();