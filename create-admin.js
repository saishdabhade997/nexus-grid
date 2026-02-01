require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // We use this to make a REAL password

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
    try {
        // 1. Create a real hash for password "admin123"
        const passwordHash = await bcrypt.hash("admin123", 10);
        console.log("🔐 Password hashed successfully.");

        // 2. Insert or Update the Admin
        const sql = `
            INSERT INTO users (email, password_hash, role, is_admin, plan, created_at)
            VALUES ('admin@nexusgrid.com', $1, 'admin', TRUE, 'enterprise', NOW())
            ON CONFLICT (email) 
            DO UPDATE SET 
                password_hash = $1, 
                is_admin = TRUE, 
                role = 'admin';
        `;

        await pool.query(sql, [passwordHash]);
        console.log("✅ SUCCESS: Admin User Created/Updated!");
        console.log("👉 Email: admin@nexusgrid.com");
        console.log("👉 Pass:  admin123");
        
        process.exit(0);
    } catch (err) {
        console.error("❌ Error creating admin:", err);
        process.exit(1);
    }
}

createAdmin();