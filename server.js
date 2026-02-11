require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require ('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

// Handle favicon requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // No Content - tells browser to stop requesting
});
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========================================
// DATABASE CONNECTION
const isProduction = process.env.NODE_ENV === 'production';

// Render provides a single 'DATABASE_URL' variable
// For local testing, you can still use your old .env variables if you want, 
// but this setup prioritizes the Cloud URL.
const connectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false // ⚠️ REQUIRED for Render
});

pool.connect()
    .then(() => console.log(`✅ Connected to Database (SSL: ${isProduction})`))
    .catch(err => {
        console.error('❌ Database Connection Error:', err.message);
        // Do not exit process in cloud, just log the error so the server stays alive
    });
// ========================================
// SERVER & SOCKET SETUP
// ========================================
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        // Allow ANY origin to connect (Easiest fix for Render)
        origin: "*", 
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization"],
        credentials: true
    },
    // Increase ping timeout to prevent "looping" disconnects on slow networks
    pingTimeout: 60000, 
    pingInterval: 25000
});


  /**
 * ✅ Sanitize and validate telemetry data before broadcasting
 */
function sanitizeTelemetryForBroadcast(rawData) {
    return {
        // Voltage (3-phase + neutral)
        voltage_r: parseFloat(rawData.voltage_r || 0),
        voltage_y: parseFloat(rawData.voltage_y || 0),
        voltage_b: parseFloat(rawData.voltage_b || 0),
        
        // Current (3-phase + neutral)
        current_r: parseFloat(rawData.current_r || 0),
        current_y: parseFloat(rawData.current_y || 0),
        current_b: parseFloat(rawData.current_b || 0),
        current_n: parseFloat(rawData.current_n || 0),
        
        // Power Parameters
        active_power: parseFloat(rawData.active_power || 0),
        apparent_power: parseFloat(rawData.apparent_power || 0),
        reactive_power: parseFloat(rawData.reactive_power || 0),
        power_factor: parseFloat(rawData.power_factor || 0),
        
        // Voltage Harmonics (THD)
        v_thd_r: parseFloat(rawData.v_thd_r || 0),
        v_thd_y: parseFloat(rawData.v_thd_y || 0),
        v_thd_b: parseFloat(rawData.v_thd_b || 0),
        
        // Current Harmonics (THD)
        i_thd_r: parseFloat(rawData.i_thd_r || 0),
        i_thd_y: parseFloat(rawData.i_thd_y || 0),
        i_thd_b: parseFloat(rawData.i_thd_b || 0),
        
        // Energy Counters
        energy_kwh: parseFloat(rawData.energy_kwh || 0),
        energy_kvah: parseFloat(rawData.energy_kvah || 0),
        energy_kvarh: parseFloat(rawData.energy_kvarh || 0),
        
        // System Health
        frequency: parseFloat(rawData.frequency || 50.0),
        meter_temperature: parseFloat(rawData.meter_temperature || 0),
        
        // Metadata (use both deviceId and device_id for compatibility)
        deviceId: rawData.deviceId || 'UNKNOWN',
        device_id: rawData.deviceId || rawData.device_id || 'UNKNOWN',
        timestamp: new Date().toISOString()
    };
}
// ✅ FORCE SECURE CONNECTION (No variables, just raw settings)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,        // ✅ Hardcoded: Forces SSL
  secure: true,     // ✅ Hardcoded: Required for 465
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASS  // Your App Password
  },
  tls: {
    // This helps if Render has issues with certificates
    rejectUnauthorized: false
  },
  connectionTimeout: 10000 // 10 seconds wait time
});

// Add this verification block to see if it connects on startup
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ TRANSPORTER ERROR:", error);
  } else {
    console.log("✅ TRANSPORTER READY: Connected to Gmail 465");
  }
});

let lastEmailSentTime = 0;
let isProcessingAlert = false;

// ========================================
// REAL-TIME ALERT COOLDOWN MAP
// ========================================
// Tracks last alert sent time per device & alert type to prevent spam (15 minute cooldown)
// Format: Map<"deviceId:alertType", timestamp>
const alertCooldowns = new Map(); 
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
/**
 * Custom error class for operational errors
 */
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

// ========================================
// MIDDLEWARE
// ========================================

/**
 * JWT Authentication Middleware
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}
const requireAdmin = (req, res, next) => {
    // 1. Check if user exists (from auth middleware)
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    // 2. STRICT CHECK: Must have admin flag in token
    // (Our new login route puts this there)
    if (req.user.is_admin !== true && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Admin Access Only" });
    }

    next();
};
/**
 * Telemetry Data Validation Middleware
 */
function validateTelemetry(req, res, next) {
    const { body } = req;
    
    // Required fields
    const requiredFields = ['active_power', 'power_factor', 'apparent_power'];
    for (const field of requiredFields) {
        if (body[field] === undefined && body[field] !== 0) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }
    
    // Range validation
    const pf = parseFloat(body.power_factor);
    if (isNaN(pf) || pf < 0 || pf > 1) {
        return res.status(400).json({ error: 'Power factor must be between 0 and 1' });
    }
    
    const ap = parseFloat(body.active_power);
    if (isNaN(ap) || ap < 0) {
        return res.status(400).json({ error: 'Active power must be non-negative' });
    }
    
    next();
}

// ========================================
// ROUTES
// ========================================

app.post('/api/signup', async (req, res) => {
    // 1. Capture ALL fields sent from frontend
    const { name, email, password, plan } = req.body;

    // 2. Validation
    if (!email || !password) {
        return res.status(400).json({ error: "Email and Password are required" });
    }

    try {
        // 3. Check if user exists
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) {
            return res.status(409).json({ error: "User already exists. Please log in." });
        }

        // 4. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // 5. Define Role (Fixes the "role is not defined" error)
        const role = 'user'; 

        // 6. Insert User (Updated to save Name and Plan)
        // We use COALESCE to handle cases where 'full_name' column might be missing in older DBs
        let newUser;
        try {
            newUser = await pool.query(
                `INSERT INTO users (full_name, email, password_hash, role, plan, created_at) 
                 VALUES ($1, $2, $3, $4, $5, NOW()) 
                 RETURNING id, email, role, plan`,
                [name || 'User', email, hash, role, plan || 'essential']
            );
        } catch (dbErr) {
            // Fallback if 'full_name' column doesn't exist yet
            newUser = await pool.query(
                `INSERT INTO users (email, password_hash, role, plan, created_at) 
                 VALUES ($1, $2, $3, $4, NOW()) 
                 RETURNING id, email, role, plan`,
                [email, hash, role, plan || 'essential']
            );
        }

        const user = newUser.rows[0];

        // 7. Auto-Provision Device (Fixes the syntax in Image 3)
        // We insert default values for safety thresholds (456, 373, 110)
        await pool.query(
            `INSERT INTO devices (
                device_id, device_name, user_id, 
                v_ov, v_uv, i_oc, tariff_config
            ) VALUES ($1, $2, $3, 456, 373, 110, '{}')`,
            [`meter_${user.id}_01`, 'Main Incomer', user.id]
        );

        // 8. Generate Token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );

        res.json({ token, user });

    } catch (err) {
        console.error("Signup Error:", err.message);
        res.status(500).json({ error: "Server error during registration" });
    }
});
app.delete('/api/alarms/archive', authenticateToken, async (req, res) => {
    try {
        // Execute deletion
        await pool.query('DELETE FROM alarm_logs');
        
        console.log(`🗑️ Alarm Archive cleared by user: ${req.user.email}`);
        res.json({ status: 'success', message: 'All alarm logs permanently deleted.' });
        
    } catch (err) {
        console.error('Clear Archive Error:', err.message);
        res.status(500).json({ error: 'Database failed to clear logs' });
    }
});
// --- APPROVAL SYSTEM ROUTES ---

// 1. User: Submit a Request (Instead of saving directly)
app.post('/api/user/request-change', authenticateToken, async (req, res) => {
    const { type, payload } = req.body; // e.g. type="DATA_PERSISTENCE"
    
    try {
        await pool.query(
            `INSERT INTO pending_requests (user_id, request_type, payload) VALUES ($1, $2, $3)`,
            [req.user.id, type, JSON.stringify(payload)]
        );
        res.json({ message: "Request queued for Admin approval." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to submit request" });
    }
});

// 2. Admin: View All Pending Requests
app.get('/api/admin/requests', authenticateToken, async (req, res) => {
    // Security Check: Only Admins
    if (req.user.role !== 'admin') return res.sendStatus(403);
    
    try {
        const result = await pool.query(`
            SELECT r.id, r.request_type as type, r.payload, r.created_at, u.email as user_email 
            FROM pending_requests r
            JOIN users u ON r.user_id = u.id
            WHERE r.status = 'PENDING'
            ORDER BY r.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Error fetching requests" });
    }
});

// 3. Admin: Approve or Reject a Request
app.post('/api/admin/requests/:id/:action', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { id, action } = req.params; // action will be 'approve' or 'reject'
    
    try {
        if (action === 'reject') {
            await pool.query("UPDATE pending_requests SET status = 'REJECTED' WHERE id = $1", [id]);
            return res.json({ message: "Request Rejected" });
        }

     if (action === 'approve') {
            // A. Get the request details
            const reqData = await pool.query("SELECT * FROM pending_requests WHERE id = $1", [id]);
            if (reqData.rows.length === 0) return res.status(404).json({error: "Request not found"});
            
            const request = reqData.rows[0];

            // B. APPLY THE CHANGE
            if (request.request_type === 'SYSTEM_SETTINGS_UPDATE') {
                // Extract data from the JSON payload
                const { data_persistence, retention_days, enable_alerts, alert_email } = request.payload;

                // Update the User's settings in the users table
                await pool.query(
                    `UPDATE users SET 
                        data_persistence = $1, 
                        retention_days = $2, 
                        enable_alerts = $3, 
                        alert_email = $4 
                     WHERE id = $5`, 
                    [data_persistence, retention_days, enable_alerts, alert_email, request.user_id]
                );
            }

            // C. Mark as Approved
            await pool.query("UPDATE pending_requests SET status = 'APPROVED' WHERE id = $1", [id]);
            return res.json({ message: "Request Approved & Applied" });
        }    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Action failed" });
    }
});

/**
 * LOGIN ROUTE - Generate JWT token
 */
/* =========================================
   ALARM ARCHIVE API
   ========================================= */
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = userResult.rows[0];
        if (user.is_blocked) {
    return res.status(403).json({ error: "ACCOUNT SUSPENDED. Contact Administration." });
}
        // Compare hashed password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-this',
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role
            }
        });
        
    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login' });
    }
});
/* ==================================================
   🔐 DEDICATED ADMIN LOGIN
   Only allows users with is_admin = true to sign in
   ================================================== */
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Identity required' });
        }

        // 1. Fetch user AND check is_admin flag immediately
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            // Security: Generic error message to prevent email enumeration
            return res.status(401).json({ error: 'Access Denied' }); 
        }

        const user = userResult.rows[0];

        // 2. CRITICAL SECURITY CHECK: Is this user an Admin?
        if (user.is_admin !== true && user.role !== 'admin') {
            console.warn(`⚠️ Blocked non-admin login attempt: ${email}`);
            return res.status(403).json({ error: 'Unauthorized: Admin privileges required.' });
        }

        // 3. Verify Password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Access Denied' });
        }

        // 4. Generate Token (Payload includes admin flag)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: 'admin', is_admin: true },
            process.env.JWT_SECRET || 'your-secret-key-change-this',
            { expiresIn: '12h' } // Admin sessions expire faster (safety)
        );

        console.log(`👑 Admin Logged In: ${email}`);
        
        res.json({
            token,
            user: { id: user.id, email: user.email, role: 'admin' }
        });

    } catch (err) {
        console.error('Admin Login Error:', err.message);
        res.status(500).json({ error: 'Server Authorization Error' });
    }
});

// 1. Request Password Reset (REAL EMAIL VERSION)
// 1. Request Password Reset (FIXED - NO SYNTAX ERRORS)
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        console.log(`🔑 Password reset requested for: ${email}`);

        // --- RATE LIMITING (FIXED LOGIC) ---
        const checkCooldown = await pool.query(
            `SELECT reset_expires FROM users 
             WHERE email = $1 
             AND reset_expires > NOW()`, 
            [email]
        );

        if (checkCooldown.rows.length > 0) {
            const expiresAt = new Date(checkCooldown.rows[0].reset_expires);
            const minutesLeft = Math.ceil((expiresAt - new Date()) / 60000);
            
            console.log(`⏳ Rate limit: User must wait ${minutesLeft} more minutes`);
            return res.status(429).json({ 
                error: `Please wait ${minutesLeft} minutes before requesting another link.` 
            });
        }

        // --- GENERATE TOKEN & SAVE ---
        const token = crypto.randomBytes(32).toString('hex');
        
        const result = await pool.query(
            `UPDATE users 
             SET reset_token = $1, reset_expires = NOW() + INTERVAL '1 hour' 
             WHERE email = $2 
             RETURNING id, email`,
            [token, email]
        );

        // --- SECURITY: Don't reveal if email exists ---
        if (result.rows.length === 0) {
            console.log(`⚠️ Password reset requested for non-existent email: ${email}`);
            return res.json({ 
                message: "If that email exists in our system, we've sent a reset link." 
            });
        }

        // --- CONSTRUCT RESET LINK ---
        const resetLink = `https://nexusgrid-api.onrender.com/reset-password.html?token=${token}`;

        // --- SEND EMAIL ---
        const mailOptions = {
            from: `"NexusGrid Security" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '🔒 Reset Your Password - NexusGrid',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                    <h2 style="color: #0ea5e9; text-align: center;">NexusGrid Password Reset</h2>
                    <p style="color: #334155;">Hello,</p>
                    <p style="color: #334155;">We received a request to reset your password. Click the button below to proceed:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background-color: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
                    </div>
                    
                    <p style="color: #334155; margin-top: 20px;">Or copy this link:</p>
                    <p style="color: #64748b; font-size: 12px; word-break: break-all;">${resetLink}</p>
                    
                    <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 30px;">This link expires in 1 hour. If you did not request this, please ignore this email.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        
        console.log(`✅ Password reset email sent to ${email}`);
        res.json({ 
            message: "If that email exists in our system, we've sent a reset link." 
        });

    } catch (err) {
        console.error("❌ PASSWORD RESET ERROR:", err);
        console.error("Error Code:", err.code);
        console.error("Error Message:", err.message);
        
        // ✅ Detailed error for debugging (remove in production)
        res.status(500).json({ 
            error: err.message, 
            code: err.code,
            hint: "Check server logs for details"
        });
    }
}); // ✅ PROPER CLOSING BRACE
// 5. ADMIN: BLOCK/UNBLOCK USER
app.put('/api/admin/users/:id/block', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { blocked } = req.body; // true or false

    try {
        await pool.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [blocked, id]);
        
        const status = blocked ? "BLOCKED" : "ACTIVATED";
        console.log(`👑 Admin ${status} User ID ${id}`);
        
        res.json({ success: true, message: `User ${status}` });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});
// 2. Perform Password Reset
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        // Find user with this token AND make sure it hasn't expired
        const userCheck = await pool.query(
            `SELECT * FROM users WHERE reset_token = $1 AND reset_expires > NOW()`,
            [token]
        );

        if (userCheck.rows.length === 0) {
            return res.status(400).json({ error: "Token is invalid or expired" });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear the token
        await pool.query(
            `UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2`,
            [hashedPassword, userCheck.rows[0].id]
        );

        res.json({ message: "Password updated successfully" });

    } catch (err) {
        console.error("Reset Password Error:", err);
        res.status(500).json({ error: "Server error" });
    }
});
// 1. GET ALL METERS (Populates the Header Dropdown)
// 1. GET ALL METERS (SECURE)
app.get('/api/my-meters', authenticateToken, async (req, res) => {
    try {
        // 🔒 SECURE: Only fetch devices belonging to req.user.id
        const result = await pool.query(
            'SELECT device_id, device_name FROM devices WHERE user_id = $1 ORDER BY device_id ASC', 
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Get Meters Error:", err.message);
        res.status(500).json({ error: "Failed to fetch meters" });
    }
});
/* ========================================================
   ✅ NEW ROUTES: PER-DEVICE SETTINGS (Safety & Tariff)
   ======================================================== */

// 1. GET Safety Settings for a specific meter
// 1. GET Safety Settings (SECURE)
app.get('/api/devices/:id/safety', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 🔒 Added "AND user_id = $2" to ensure only the owner can see settings
        const result = await pool.query(
            `SELECT 
                v_ov, v_uv, v_imb, 
                i_oc, i_imb, i_neu, t_int, 
                allotted_load, pf_lag, pf_lead,
                alert_email, enable_email_alerts
             FROM devices WHERE device_id = $1 AND user_id = $2`, 
            [id, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(403).json({ error: "Access Denied: Device not found or you do not own it." });
        }
        
        res.json(result.rows[0]); 
    } catch (err) {
        console.error("GET Safety Error:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});
// POST: Save Admin Settings
app.post('/api/admin/settings', async (req, res) => {
    const { dataPersistence, alertsEnabled, retentionDays } = req.body;
    
    try {
        // Save to DB
        await pool.query(
            `INSERT INTO system_settings (key_name, value_json) 
             VALUES ('kernel_config', $1) 
             ON CONFLICT (key_name) 
             DO UPDATE SET value_json = $1`,
            [JSON.stringify(req.body)]
        );

        // Update global variable in memory (for speed)
        global.SYSTEM_CONFIG = req.body; 

        res.json({ message: "Settings saved" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

// 2. PUT (Save) Safety Settings for a specific meter
// 2. SAVE Safety Settings (SECURE)
app.put('/api/devices/:id/safety', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const b = req.body; // Data from frontend
    
    try {
        // 🔒 Added "AND user_id = $14" to prevent unauthorized changes
        const result = await pool.query(
            `UPDATE devices SET 
             v_ov=$1, v_uv=$2, v_imb=$3,
             i_oc=$4, i_imb=$5, i_neu=$6, t_int=$7,
             allotted_load=$8, pf_lag=$9, pf_lead=$10,
             alert_email=$11, enable_email_alerts=$12
             WHERE device_id = $13 AND user_id = $14`,
            [
             b.v_ov, b.v_uv, b.v_imb, 
             b.i_oc, b.i_imb, b.i_neu, b.t_int, 
             b.allotted_load, b.pf_lag, b.pf_lead, 
             b.alert_email, b.enable_email_alerts, 
             id, 
             req.user.id // <--- Pass User ID from Token
            ]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: "Access Denied: You do not own this device." });
        }
        
        res.json({ success: true, message: "Safety rules updated successfully." });
    } catch (err) {
        console.error("PUT Safety Error:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

// 5. POST Claim Device (Link a new meter to user account)
app.post('/api/devices/claim', authenticateToken, async (req, res) => {
    const { deviceId, friendlyName } = req.body;
    
    if (!deviceId || !friendlyName) {
        return res.status(400).json({ error: 'Device ID and friendly name required' });
    }
    
    try {
        // Check if device already exists
        const existing = await pool.query('SELECT device_id FROM devices WHERE device_id = $1', [deviceId]);
        
        if (existing.rows.length > 0) {
            // Update existing device name
            await pool.query('UPDATE devices SET device_name = $1 WHERE device_id = $2', [friendlyName, deviceId]);
            res.json({ success: true, message: 'Device name updated' });
        } else {
            // Create new device with default settings
            await pool.query(`
                INSERT INTO devices (device_id, device_name, tariff_config, v_ov, v_uv, v_imb, i_oc, i_imb, i_neu, t_int, allotted_load, pf_lag, pf_lead)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                deviceId,
                friendlyName,
              JSON.stringify({}), // Empty config, strictly engineering
                456, 373, 3, 110, 15, 30, 75, 500, 0.90, 0.98
            ]);
            res.json({ success: true, message: 'Device claimed successfully' });
        }
    } catch (err) {
        console.error('Claim Device Error:', err.message);
        res.status(500).json({ error: 'Failed to claim device' });
    }
});
// 5. ADMIN: FORCE RESET USER PASSWORD
app.put('/api/admin/users/:id/password', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    try {
        // 1. Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);

        // 2. Update Database
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING email',
            [hash, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        console.log(`👑 Admin reset password for User ${result.rows[0].email} (ID: ${id})`);
        res.json({ success: true, message: "Password updated successfully" });

    } catch (err) {
        console.error("Admin Password Reset Error:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});
// PUBLIC REGISTRATION ROUTE
/* ============================================================
   ✅ AUTH ROUTE: REGISTER (Updated for Premium Page)
   ============================================================ */
/*app.post('/api/signup', async (req, res) => {
    const { name, email, password, plan } = req.body;

    // 1. Basic Validation
    if (!email || !password) {
        return res.status(400).json({ error: "Email and Password are required" });
    }

    try {
        // 2. Check if user exists
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: "User already exists. Please log in." });
        }

        // 3. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // 4. Insert User
        // Note: If you haven't run the SQL command yet, remove 'full_name' from this query
        const newUser = await pool.query(
            `INSERT INTO users (full_name, email, password_hash, role, plan, created_at) 
             VALUES ($1, $2, $3, 'user', $4, NOW()) 
             RETURNING id, email, role, full_name`,
            [name || 'Anonymous', email, hash, plan || 'essential']
        );

        const user = newUser.rows[0];

        // 5. Auto-assign a Safe Demo Meter
        // We include default safety thresholds so the dashboard works instantly without setup
        await pool.query(
            `INSERT INTO devices (
                device_id, device_name, user_id, 
                v_ov, v_uv, i_oc, tariff_config
            ) VALUES ($1, $2, $3, 456, 373, 110, '{}')`,
            [`meter_${user.id}_01`, 'Main Incomer', user.id]
        );

        // 6. Generate Token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-this',
            { expiresIn: '24h' }
        );

        console.log(`🚀 New User Registered: ${email}`);
        res.json({ token, user });

    } catch (err) {
        console.error("Signup Error:", err.message);
        
        // Handle missing column error specifically to help you debug
        if (err.message.includes("column \"full_name\" does not exist")) {
            console.error("⚠️ TIP: Run 'ALTER TABLE users ADD COLUMN full_name VARCHAR(100);' in your DB.");
            return res.status(500).json({ error: "Database needs update (Missing Name Column)" });
        }

        res.status(500).json({ error: "Registration failed" });
    }
});*/
// 6. DELETE Device (Unclaim/Remove meter)
app.delete('/api/devices/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check if device exists
        const deviceCheck = await pool.query(
            'SELECT device_id, device_name FROM devices WHERE device_id = $1',
            [id]
        );
        
        if (deviceCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const deviceName = deviceCheck.rows[0].device_name || id;
        
        // Delete device (CASCADE will handle dependent tables: telemetry, alarm_logs, etc.)
        await pool.query('DELETE FROM devices WHERE device_id = $1', [id]);
        
        console.log(`🗑️ Device deleted: ${deviceName} (${id}) by user: ${req.user.email}`);
        
        res.json({ 
            success: true, 
            message: `Device "${deviceName}" has been permanently deleted. All associated data (telemetry, alarms, billing) has been removed.`
        });
        
    } catch (err) {
        console.error('Delete Device Error:', err.message);
        res.status(500).json({ error: 'Failed to delete device' });
    }
});
/* ============================================================
   EMAIL ALERTS (Multi-Tenant)
   ============================================================ */

/* ============================================================
   ENGINEERING ALERTS v2.0 (Includes kVA Capacity & PF Status)
   ============================================================ */
async function checkRealTimeSafetyAlerts(data) {
    try {
        const deviceId = data.deviceId || data.device_id;
        
        // 1. Live Telemetry
        const vR = parseFloat(data.voltage_r || 0);
        const vY = parseFloat(data.voltage_y || 0);
        const vB = parseFloat(data.voltage_b || 0);
        const cR = parseFloat(data.current_r || 0);
        const cY = parseFloat(data.current_y || 0);
        const cB = parseFloat(data.current_b || 0);
        const cN = parseFloat(data.current_n || 0);
        const pf = parseFloat(data.power_factor || 1.0);
        const kva = parseFloat(data.apparent_power || 0); // ✅ Total Load
        const temp = parseFloat(data.meter_temperature || 0);

        if (!deviceId || kva === 0) return;

        // ========================================
        // STEP 1: FETCH LIMITS (Including kVA & Lead PF)
        // ========================================
        // ✅ NEW CODE (Paste this)
const res = await pool.query(`
    SELECT 
        d.device_name, 
        d.v_ov, d.v_uv, d.v_imb,
        d.i_oc, d.i_imb, d.i_neu, 
        d.t_int, 
        d.allotted_load,
        d.pf_lag,       
        d.pf_lead,      
        u.email as owner_email, u.preferences,
        u.plan  -- <--- WE ADDED THIS
    FROM devices d
    JOIN users u ON d.user_id = u.id
    WHERE d.device_id = $1
`, [deviceId]);

        if (res.rows.length === 0) return;

        const row = res.rows[0];
        const deviceName = row.device_name || deviceId;
        
        // --- THRESHOLDS ---
        const limits = {
            v_ov: parseFloat(row.v_ov || 456),
            v_uv: parseFloat(row.v_uv || 373),
            i_oc: parseFloat(row.i_oc || 110),
            i_neu: parseFloat(row.i_neu || 30),
            i_imb: parseFloat(row.i_imb || 20),
            t_int: parseFloat(row.t_int || 75),
            
            // ✅ THE MISSING PARAMETERS
            max_kva: parseFloat(row.allotted_load || 500), // Transformer Capacity
            pf_min_lag: parseFloat(row.pf_lag || 0.90),    // Efficiency Floor
            pf_min_lead: parseFloat(row.pf_lead || 0.95)   // Capacitive Limit
        };

        const prefs = row.preferences || {};
        const enableAlerts = prefs.enable_alerts !== false;
        const alertEmail = prefs.alert_email || row.owner_email;

        // ========================================
        // STEP 2: PHYSICS ENGINE CHECKS
        // ========================================
        let faults = []; 

        // 1. VOLTAGE SAFETY
        const maxV = Math.max(vR, vY, vB);
        const minV = Math.min(vR, vY, vB);
        if (maxV > limits.v_ov) faults.push({ type: 'OV', level: 'CRITICAL', msg: `Surge: ${maxV.toFixed(1)}V > ${limits.v_ov}V` });
        else if (minV < limits.v_uv && minV > 50) faults.push({ type: 'UV', level: 'WARNING', msg: `Sag: ${minV.toFixed(1)}V < ${limits.v_uv}V` });

        // 2. CURRENT OVERLOAD
        const maxI = Math.max(cR, cY, cB);
        if (maxI > limits.i_oc) faults.push({ type: 'OC', level: 'CRITICAL', msg: `Over Current: ${maxI.toFixed(1)}A > ${limits.i_oc}A` });

        // 3. ✅ CAPACITY OVERLOAD (kVA / Allotted Load)
        // Checks if total demand exceeds the transformer/contract rating
        if (kva > limits.max_kva) {
            const overloadPct = ((kva - limits.max_kva) / limits.max_kva) * 100;
            faults.push({ 
                type: 'MD_EXCEEDED', 
                level: 'CRITICAL', 
                msg: `Capacity Overload: ${kva.toFixed(1)} kVA > ${limits.max_kva} kVA (+${overloadPct.toFixed(1)}%)` 
            });
        }

        // 4. ✅ POWER FACTOR HEALTH (Lagging vs Leading)
        // Note: Meters report PF 0-1. Distinguishing Lead/Lag often requires reactive power sign.
        // Assuming: Negative Reactive Power = Leading (Capacitive). Positive = Lagging (Inductive).
        const kvar = parseFloat(data.reactive_power || 0);
        
        if (maxI > 5) { // Only check PF if machine is actually running
            if (kvar >= 0) {
                // LAGGING (Inductive - Motors)
                if (pf < limits.pf_min_lag && pf > 0) {
                    faults.push({ type: 'PF_LAG', level: 'WARNING', msg: `Poor Efficiency (Lag): ${pf.toFixed(2)}` });
                }
            } else {
                // LEADING (Capacitive - Over-correction)
                // Leading PF below target (e.g. 0.8 Lead) is dangerous for voltage
                if (pf < limits.pf_min_lead && pf > 0) {
                    faults.push({ type: 'PF_LEAD', level: 'WARNING', msg: `Unstable Leading PF: ${pf.toFixed(2)}` });
                }
            }
        }

        // 5. IMBALANCE & NEUTRAL
        if (maxI > 10) {
            const avgI = (cR + cY + cB) / 3;
            if (avgI > 0) {
                const maxDev = Math.max(Math.abs(cR - avgI), Math.abs(cY - avgI), Math.abs(cB - avgI));
                const imbPercent = (maxDev / avgI) * 100;
                if (imbPercent > limits.i_imb) faults.push({ type: 'IMB', level: 'WARNING', msg: `Phase Imbalance: ${imbPercent.toFixed(1)}%` });
            }
        }
        if (cN > limits.i_neu) faults.push({ type: 'NEU', level: 'WARNING', msg: `High Neutral Current: ${cN.toFixed(1)}A` });

        // 6. TEMP
        if (temp > limits.t_int) faults.push({ type: 'TEMP', level: 'DANGER', msg: `Overheating: ${temp.toFixed(1)}°C` });

        // ========================================
        // STEP 3: ALERTING (No Changes Needed Here)
        // ========================================
        if (faults.length === 0) return;

        const priorityFault = faults.find(f => f.level === 'CRITICAL' || f.level === 'DANGER') || faults[0];
        const now = Date.now();
        const timestamp = new Date();

        // Log to DB
        for (const f of faults) {
           // ✅ Corrected Query: Uses 'alarm_level'
        await pool.query(
    `INSERT INTO alarm_logs (timestamp, alarm_type, alarm_level, message, value_at_time, threshold_limit, device_id)
     VALUES ($1, $2, $3, $4, 0, 0, $5)`,
    [timestamp, f.type, f.level, f.msg, deviceId] // Note: You can keep the JS variable as f.level, just change the SQL column name
            );
        }
        console.log(`⚠️ ${priorityFault.type} on ${deviceId}`);
         const userPlan = res.rows[0].plan;
if (userPlan === 'essential' || userPlan === 'free') {
    return; // Stop here, do not send email
}
        // Send Email
        if (enableAlerts && alertEmail) {
            const cooldownKey = `${deviceId}:${priorityFault.type}`;
            const lastEmail = alertCooldowns.get(cooldownKey) || 0;

            if (now - lastEmail > ALERT_COOLDOWN_MS) {
        // ✅ FORCE SECURE CONNECTION (No variables, just raw settings)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,        // ✅ Hardcoded: Forces SSL
  secure: true,     // ✅ Hardcoded: Required for 465
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASS  // Your App Password
  },
  tls: {
    // This helps if Render has issues with certificates
    rejectUnauthorized: false
  },
  connectionTimeout: 10000 // 10 seconds wait time
});

// Add this verification block to see if it connects on startup
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ TRANSPORTER ERROR:", error);
  } else {
    console.log("✅ TRANSPORTER READY: Connected to Gmail 465");
  }
});

                await transporter.sendMail({
                    from: `"NexusGrid Safety" <${process.env.EMAIL_USER}>`,
                    to: alertEmail,
                    subject: `[${priorityFault.level}] ${priorityFault.type} Alert: ${deviceName}`,
                    text: priorityFault.msg // Simplified text for brevity here, HTML is better
                });

                alertCooldowns.set(cooldownKey, now);
            }
        }

    } catch (err) {
        console.error('❌ Safety Engine Crash:', err.message);
    }
});

app.post('/api/telemetry', validateTelemetry, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const data = req.body;
        const deviceId = data.deviceId || data.device_id; // MUST EXIST
        
        // 1. Validation: Reject anonymous data
        if (!deviceId) {
            throw new AppError('Device ID is missing from packet', 400);
        }

        const now = new Date();
        const currentHour = now.getHours();
        
        // --- PART 3: CALCULATE COSTS ---
        const kw = parseFloat(data.active_power || 0);
        const pf = parseFloat(data.power_factor || 1.0);
        const reactiveP = parseFloat(data.reactive_power || 0);
        const apparentPower = parseFloat(data.apparent_power || 0);
        // --- PART 5: ARCHIVE TELEMETRY ---
        const telemetryQuery = `
            INSERT INTO telemetry (
                device_id, voltage_r, voltage_y, voltage_b, v_thd_r, v_thd_y, v_thd_b,
                current_r, current_y, current_b, current_n, i_thd_r, i_thd_y, i_thd_b,
                active_power, apparent_power, reactive_power, power_factor, frequency,
                energy_kwh, energy_kvah, energy_kvarh, meter_temperature
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23
            )
        `;
        
        const telemetryValues = [
            deviceId,
            data.voltage_r || 0, data.voltage_y || 0, data.voltage_b || 0,
            data.v_thd_r || 0, data.v_thd_y || 0, data.v_thd_b || 0,
            data.current_r || 0, data.current_y || 0, data.current_b || 0, data.current_n || 0,
            data.i_thd_r || 0, data.i_thd_y || 0, data.i_thd_b || 0,
            data.active_power || 0, data.apparent_power || 0, data.reactive_power || 0,
            data.power_factor || 0, data.frequency || 50.0,
            data.energy_kwh || 0, data.energy_kvah || 0, data.energy_kvarh || 0,
            data.meter_temperature || 0
        ];
        
        await client.query(telemetryQuery, telemetryValues);
        await client.query('COMMIT');

        // --- PART 6: ALERTS (Non-Blocking) ---
        checkRealTimeSafetyAlerts(data).catch(e => console.error("Safety Check Error", e));
        
            // Send Data Packet
        const broadcastData = sanitizeTelemetryForBroadcast(data);
        broadcastData.device_id = deviceId; // Ensure ID is correct

        io.emit('new-data', broadcastData);

        res.json({ status: 'success', device: deviceId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Telemetry Error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

/**
 * GET LATEST TELEMETRY (For Safety Engine)
 */
app.get('/api/telemetry/latest', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM telemetry ORDER BY id DESC LIMIT 1'
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No telemetry data available yet' });
        }
        
        res.json(result.rows[0]);
        
    } catch (err) {
        console.error('Latest Telemetry Fetch Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch latest telemetry' });
    }
});

/**
 * ALARM ARCHIVE - Get historical alarms with pagination
 */
/**
 * ✅ ALARM ARCHIVE - Get historical alarms with pagination
 * Fetches from alarm_logs table (database-backed security logs)
 */
app.get('/api/alarms/archive', async (req, res) => {
    const { date, page = 1, limit = 20, deviceId } = req.query;
    
    // ✅ VALIDATION: Require date parameter
    if (!date) {
        return res.status(400).json({ 
            error: 'Date parameter required',
            usage: '/api/alarms/archive?date=2025-01-21&page=1&limit=20&deviceId=meter_01'
        });
    }
    
    // ✅ SANITIZE: Prevent SQL injection
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;
    
    try {
        // ✅ MULTI-TENANT: Build device filter
        let deviceFilter = '';
        let dataParams = [date];
        let countParams = [date];
        let paramIndex = 2;
        
        if (deviceId) {
            deviceFilter = `AND device_id = $${paramIndex}`;
            dataParams.push(deviceId);
            countParams.push(deviceId);
            paramIndex++;
        }
        
        dataParams.push(limitNum, offset);
        
        // ✅ QUERY: Fetch from alarm_logs table with device filter
        const dataQuery = `
            SELECT 
                id,
                timestamp,
                alarm_type,
                alarm_level as level,
                message,
                value_at_time,
                threshold_limit,
                device_id
            FROM alarm_logs 
            WHERE DATE(timestamp) = $1::date ${deviceFilter}
            ORDER BY timestamp DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        const countQuery = `
            SELECT COUNT(*) as total
            FROM alarm_logs 
            WHERE DATE(timestamp) = $1::date ${deviceFilter}
        `;
        
        // ✅ EXECUTE: Parallel queries for performance
        const [dataRes, countRes] = await Promise.all([
            pool.query(dataQuery, dataParams),
            pool.query(countQuery, countParams)
        ]);
        
        const totalRecords = parseInt(countRes.rows[0]?.total || 0);
        const totalPages = Math.ceil(totalRecords / limitNum);
        
        // ✅ RESPONSE: Structured data
        res.status(200).json({
            logs: dataRes.rows,
            total: totalRecords,
            totalPages: totalPages,
            currentPage: pageNum,
            limit: limitNum,
            date: date
        });
        
    } catch (err) {
        console.error('❌ Alarm Archive Error:', err.message);
        res.status(500).json({ 
            error: 'Failed to fetch alarm archive',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/**
 * HISTORICAL DATA - For charts and audit logs
 */
app.get('/api/history', async (req, res) => {
    const { range, start, end, deviceId } = req.query;
    
    try {
        let sql = '';
        let params = [];
        let paramIndex = 1;
        
        // Build device filter if provided
        const deviceFilter = deviceId ? `device_id = $${paramIndex++}` : '';
        if (deviceId) params.push(deviceId);
       // SCENARIO 1: Date Range Query (for audit logs)
        if (start && end) {
            console.log(`📑 Audit Log Retrieval: ${start} to ${end}${deviceId ? ` for ${deviceId}` : ''}`);
            
            // ✅ FIX: Force the time range to cover the full day
            // We append 00:00:00 to start and 23:59:59 to end
            const fullStartDate = `${start} 00:00:00`;
            const fullEndDate = `${end} 23:59:59`;

            const whereClause = deviceFilter 
                ? `WHERE created_at BETWEEN $${paramIndex} AND $${paramIndex + 1} AND ${deviceFilter}`
                : `WHERE created_at BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
            
            sql = `
                SELECT * FROM telemetry 
                ${whereClause}
                ORDER BY created_at DESC
            `;
            
            // ✅ Pushing the modified full timestamps instead of raw dates
            params.push(fullStartDate, fullEndDate);
        }
        // SCENARIO 2: Time Range Query (for dashboard charts)
        else if (range) {
           const ALLOWED_INTERVALS = {
    '1h': '1 hour',
    '24h': '24 hours',
    '7d': '7 days',
    '30d': '30 days'
};

const intervalValue = ALLOWED_INTERVALS[range];

if (!intervalValue) {
    return res.status(400).json({ 
        error: 'Invalid range parameter',
        allowed: Object.keys(ALLOWED_INTERVALS)
    });
}
            // Raw data for short ranges
            if (range === '1h' || range === '24h') {
                const whereClause = deviceFilter 
                    ? `WHERE created_at > NOW() - $${paramIndex}::interval AND ${deviceFilter}`
                    : `WHERE created_at > NOW() - $${paramIndex}::interval`;
                
                sql = `
                    SELECT * FROM telemetry 
                    ${whereClause}
                    ORDER BY created_at ASC
                `;
                params.push(intervalValue);
            }
            // Averaged data for longer ranges
            else {
                const whereClause = deviceFilter 
                    ? `WHERE created_at > NOW() - $${paramIndex}::interval AND ${deviceFilter}`
                    : `WHERE created_at > NOW() - $${paramIndex}::interval`;
                
                sql = `
                    SELECT 
                        date_trunc('hour', created_at) as created_at,
                        device_id,
                        AVG(active_power) as active_power, 
                        AVG(apparent_power) as apparent_power,
                        AVG(power_factor) as power_factor,
                        AVG(voltage_r) as voltage_r,
                        AVG(current_r) as current_r
                    FROM telemetry 
                    ${whereClause}
                    GROUP BY 1, device_id
                    ORDER BY 1 ASC
                `;
                params.push(intervalValue);
            }
        }
        else {
            return res.status(400).json({ error: 'Either range or start/end dates required' });
        }
        
        const result = await pool.query(sql, params);
        
        // Format data for frontend
        const formatted = result.rows.map(row => {
            const entry = { ...row };
            
            Object.keys(entry).forEach(key => {
                if (key === 'created_at') {
                    entry['timestamp'] = entry[key];
                } else if (typeof entry[key] === 'number') {
                    const precision = key.includes('factor') ? 3 : 2;
                    entry[key] = parseFloat(entry[key].toFixed(precision));
                }
            });
            
            return entry;
        });
        
        res.json(formatted);
        
    } catch (err) {
        console.error('History Query Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// ========================================
// GLOBAL ERROR HANDLER
// ========================================
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    
    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : 'Internal Server Error';
    
    res.status(statusCode).json({
        status: 'error',
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

/* ============================================================
   SYSTEM SETTINGS ROUTES (Multi-Tenant / User Profile)
   Target: 'users' table -> 'preferences' column
   ============================================================ */

// 1. GET User Settings (Replaces the old global GET)
app.get('/api/settings/system', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Fetch User's specific preferences
        const result = await pool.query(
            'SELECT email, preferences FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = result.rows[0];
        const prefs = user.preferences || {};

        // Merge User Preferences with Defaults
        const response = {
            email: user.email, // Main login email
            
            // Preferences (with fallbacks)
            alert_email: prefs.alert_email || user.email, 
            enable_email_alerts: prefs.enable_alerts !== undefined ? prefs.enable_alerts : true,
            data_retention_days: prefs.retention_days || 30
            
            // NOTE: We do NOT send v_ov, i_oc etc. here anymore. 
            // Those are fetched per-device via /api/devices/:id/safety
        };
        
        res.json(response);

    } catch (err) { 
        console.error('Settings GET Error:', err);
        res.status(500).json({ error: err.message }); 
    }
});


// 2. SAVE User Settings (Replaces the old global POST)
app.post('/api/settings/system', authenticateToken, async (req, res) => {
    try {
        const { alert_email, enable_alerts, retention_days } = req.body;
        const userId = req.user.id;

        // Securely update ONLY the logged-in user's row
        // We use JSONB manipulation to update specific keys without erasing others
        const query = `
            UPDATE users 
            SET preferences = jsonb_set(
                jsonb_set(
                    jsonb_set(
                        COALESCE(preferences, '{}'::jsonb), 
                        '{enable_alerts}', 
                        $1::jsonb
                    ),
                    '{retention_days}', 
                    $2::jsonb
                ),
                '{alert_email}', 
                $3::jsonb
            )
            WHERE id = $4
            RETURNING preferences
        `;

        const values = [
            enable_alerts === undefined ? true : enable_alerts,
            parseInt(retention_days || 30),
            JSON.stringify(alert_email || ""),
            userId
        ];

        await pool.query(query, values);

        console.log(`⚙️ User ${userId} updated system preferences.`);
        res.json({ status: 'success', message: 'Preferences Saved' });

    } catch (err) {
        console.error("Settings Update Error:", err.message);
        res.status(500).json({ error: "Database error while saving settings." });
    }
});

// AUTO-CLEANUP (Runs every midnight)
// AUTO-CLEANUP (Runs every midnight at 00:00)
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('🧹 Starting Daily Data Cleanup...');

        // 1. CLEANUP FREE USERS (Keep only 24 hours)
        // Deletes telemetry for devices owned by users on 'free' or 'essential' plans
        const freeResult = await pool.query(`
            DELETE FROM telemetry t
            USING devices d, users u
            WHERE t.device_id = d.device_id
            AND d.user_id = u.id
            AND (u.plan = 'free' OR u.plan = 'essential')
            AND t.created_at < NOW() - INTERVAL '1 day'
        `);
        console.log(`   - Free Tier: Deleted ${freeResult.rowCount} old rows.`);

        // 2. CLEANUP PROFESSIONAL USERS (Keep 30 days)
        const proResult = await pool.query(`
            DELETE FROM telemetry t
            USING devices d, users u
            WHERE t.device_id = d.device_id
            AND d.user_id = u.id
            AND u.plan = 'professional'
            AND t.created_at < NOW() - INTERVAL '30 days'
        `);
        console.log(`   - Pro Tier: Deleted ${proResult.rowCount} old rows.`);

        // 3. CLEANUP ENTERPRISE USERS (Keep 90 days)
        const entResult = await pool.query(`
            DELETE FROM telemetry t
            USING devices d, users u
            WHERE t.device_id = d.device_id
            AND d.user_id = u.id
            AND u.plan = 'enterprise'
            AND t.created_at < NOW() - INTERVAL '90 days'
        `);
        console.log(`   - Enterprise: Deleted ${entResult.rowCount} old rows.`);

        console.log('✅ Data Cleanup Complete.');

    } catch (err) {
        console.error("❌ Cleanup Error:", err.message);
    }
});

cron.schedule('* * * * *', async () => {
    try {
        // 1. Fetch all enabled schedules
        const schedulesRes = await pool.query(`
            SELECT 
                id, section, email, schedule_date, schedule_time, frequency
            FROM rescheduler_settings 
            WHERE email_enabled = true 
            AND email IS NOT NULL 
            AND email != ''
            AND schedule_time IS NOT NULL
        `);

        if (schedulesRes.rows.length === 0) {
            return; // No schedules to process
        }

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDay = now.getDate();

        // 2. Process each schedule
        for (const schedule of schedulesRes.rows) {
            try {
                // Parse schedule_time (format: "HH:MM:SS" or "HH:MM")
                const timeParts = schedule.schedule_time.split(':');
                const scheduleHour = parseInt(timeParts[0], 10);
                const scheduleMinute = parseInt(timeParts[1], 10);

                // Check if current time matches scheduled time
                if (currentHour !== scheduleHour || currentMinute !== scheduleMinute) {
                    continue; // Not time yet, skip this schedule
                }

                // 3. Check frequency logic
                let shouldSend = false;

                if (schedule.frequency === 'daily') {
                    shouldSend = true;
                } else if (schedule.frequency === 'monthly') {
                    // For monthly, check if it's the scheduled day of the month
                    if (schedule.schedule_date) {
                        const scheduleDate = new Date(schedule.schedule_date);
                        const scheduledDay = scheduleDate.getDate();
                        shouldSend = (currentDay === scheduledDay);
                    } else {
                        // If no schedule_date, use the day the schedule was created
                        continue; // Skip if no date specified
                    }
                } else {
                    continue; // Unknown frequency, skip
                }

                if (!shouldSend) {
                    continue; // Conditions not met, skip
                }

                // 4. Generate Report Data from Telemetry
                let reportStats = {
                    totalEnergy: 0,
                    peakDemand: 0,
                    avgPowerFactor: 0,
                    sampleCount: 0
                };

                try {
                    // Get today's stats (or last 24 hours for daily, last month for monthly)
                    const timeRange = schedule.frequency === 'daily' 
                        ? "created_at >= CURRENT_DATE"
                        : "created_at >= DATE_TRUNC('month', CURRENT_DATE)";

                    const statsRes = await pool.query(`
                        SELECT 
                            COUNT(*) as sample_count,
                            COALESCE(SUM(active_power), 0) as total_kw,
                            COALESCE(MAX(apparent_power), 0) as peak_kva,
                            COALESCE(AVG(power_factor), 0) as avg_pf
                        FROM telemetry 
                        WHERE ${timeRange}
                    `);

                    if (statsRes.rows.length > 0) {
                        const stats = statsRes.rows[0];
                        reportStats = {
                            totalEnergy: parseFloat(stats.total_kw || 0).toFixed(2),
                            peakDemand: parseFloat(stats.peak_kva || 0).toFixed(2),
                            avgPowerFactor: parseFloat(stats.avg_pf || 0).toFixed(3),
                            sampleCount: parseInt(stats.sample_count || 0)
                        };
                    }
                } catch (statsErr) {
                    console.error(`⚠️ Error fetching stats for schedule ${schedule.id}:`, statsErr.message);
                    // Continue with default stats
                }

                // 5. Generate HTML Email Content
                const reportType = schedule.frequency === 'daily' ? 'Daily' : 'Monthly';
                const emailHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                            .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
                            .stats { background: white; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid #3b82f6; }
                            .stat-label { color: #6b7280; font-size: 12px; text-transform: uppercase; font-weight: bold; }
                            .stat-value { color: #1f2937; font-size: 24px; font-weight: bold; margin-top: 5px; }
                            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>⚡ NexusGrid ${reportType} Energy Report</h2>
                                <p style="margin: 5px 0;">Report Section: ${schedule.section}</p>
                            </div>
                            <div class="content">
                                <p>Hello,</p>
                                <p>Your automated ${reportType.toLowerCase()} energy report is ready. Here are the key metrics:</p>
                                
                                <div class="stats">
                                    <div class="stat-label">Total Energy Consumption</div>
                                    <div class="stat-value">${reportStats.totalEnergy} kWh</div>
                                </div>
                                
                                <div class="stats">
                                    <div class="stat-label">Peak Demand</div>
                                    <div class="stat-value">${reportStats.peakDemand} kVA</div>
                                </div>
                                
                                <div class="stats">
                                    <div class="stat-label">Average Power Factor</div>
                                    <div class="stat-value">${reportStats.avgPowerFactor}</div>
                                </div>
                                
                                <div class="stats">
                                    <div class="stat-label">Data Samples</div>
                                    <div class="stat-value">${reportStats.sampleCount.toLocaleString()}</div>
                                </div>
                                
                                <p style="margin-top: 20px;">
                                    <strong>Report Generated:</strong> ${now.toLocaleString()}<br>
                                    <strong>Frequency:</strong> ${schedule.frequency}
                                </p>
                            </div>
                            <div class="footer">
                                <p>This is an automated report from NexusGrid Energy Management System.</p>
                                <p>To modify your report settings, please log in to your dashboard.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

                // 6. Send Email
                await transporter.sendMail({
                    from: `"NexusGrid Reports" <${process.env.EMAIL_USER || 'YOUR_EMAIL'}>`,
                    to: schedule.email,
                    subject: `📊 ${reportType} Energy Report - ${now.toLocaleDateString()}`,
                    html: emailHtml
                });

                console.log(`🚀 ${reportType} report sent to ${schedule.email} (Schedule ID: ${schedule.id}, Section: ${schedule.section})`);

            } catch (scheduleErr) {
                // Log error but don't crash - continue processing other schedules
                console.error(`❌ Error processing schedule ${schedule.id} (${schedule.email}):`, scheduleErr.message);
            }
        }

    } catch (err) {
        // Global error handler - log but don't crash the server
        console.error('❌ Report Scheduler Error:', err.message);
    }
});
// 4. ADMIN: FORCE ASSIGN METER TO USER
app.post('/api/admin/assign-device', authenticateToken, requireAdmin, async (req, res) => {
    const { userId, deviceId, deviceName } = req.body;

    if (!userId || !deviceId) {
        return res.status(400).json({ error: "User ID and Device ID are required" });
    }

    try {
        // Check if device exists
        const check = await pool.query('SELECT device_id FROM devices WHERE device_id = $1', [deviceId]);

        if (check.rows.length > 0) {
            // CASE A: Device exists -> Move it to this user
            await pool.query(
                'UPDATE devices SET user_id = $1, device_name = COALESCE($2, device_name) WHERE device_id = $3',
                [userId, deviceName, deviceId]
            );
            console.log(`👑 Admin assigned existing device ${deviceId} to User ID ${userId}`);
        } else {
            // CASE B: Device is new -> Create it for this user (Pre-provision)
            await pool.query(`
                INSERT INTO devices (
                    device_id, user_id, device_name, 
                    tariff_config, 
                    v_ov, v_uv, v_imb, i_oc, i_imb, i_neu, t_int, allotted_load, pf_lag, pf_lead
                ) VALUES (
                    $1, $2, $3, 
                    $4,
                    456, 373, 3, 110, 15, 30, 75, 500, 0.90, 0.98
                )`, 
                [
                    deviceId, 
                    userId, 
                    deviceName || `Meter ${deviceId}`,
                    JSON.stringify({
                        
                    })
                ]
            );
            console.log(`👑 Admin pre-provisioned new device ${deviceId} for User ID ${userId}`);
        }

        res.json({ success: true, message: "Device assigned successfully" });

    } catch (err) {
        console.error("Admin Assign Error:", err.message);
        res.status(500).json({ error: "Database error during assignment" });
    }
});

app.post('/api/ai-audit', async (req, res) => {
    try {
        if (req.user.plan !== 'professional' && req.user.plan !== 'enterprise') {
            return res.status(403).json({ 
                error: "Upgrade Required", 
                message: "AI Audits are only available on the Professional Plan." 
            });
        }
        const { metrics, billing } = req.body;

        // 1. Construct a lean prompt (Save tokens/money)
        const prompt = `
        You are a Senior Industrial Energy Auditor. Analyze this factory telemetry data and provide 4 strict, technical recommendations.
        
        DATA CONTEXT:
        - Avg Power Factor: ${metrics.pf?.avg || 'N/A'} (Target: 0.99)
        - Peak Demand (MD): ${billing?.peakDemand || 0} kVA (Limit: ${billing?.contractDemand || 500} kVA)
        - Voltage Stability: Avg ${metrics.voltage?.avg || 0}V (StdDev: ${metrics.voltage?.stdDev || 0})
        - Total Energy: ${billing?.totalEnergy || 0} kWh

        OUTPUT FORMAT:
        Return exactly 3 sentences labeled 1, 2, 3. No intro. No markdown.
        1. Peak Demand specific advice.
        2. Power Factor specific advice.
        3. Voltage/Quality specific advice.
        
        `;

        // 2. Call GPT-4o-mini (Fast & Cheap) or GPT-4
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4o-mini", 
            max_tokens: 150,
            temperature: 0.5,
        });

        const rawText = completion.choices[0].message.content;
        
        // 3. Clean up formatting to array
        const insights = rawText.split('\n').filter(line => line.length > 10);
        
        res.json({ insights });

    } catch (error) {
        console.error("AI Error:", error);
        // Fallback if AI fails (e.g., quota exceeded)
        res.json({ insights: [
            "1. Peak Demand: Server connection for AI analysis timed out.",
            "2. Power Factor: Unable to retrieve real-time inference.",
            "3. Voltage Profile: Standard monitoring recommended.",
            "4. Efficiency: Review manual logs for shift optimization."
        ]});
    }
});
// ========================================
// RESCHEDULER ENDPOINTS
// ========================================

/**
 * GET Rescheduler Settings
 */
app.get('/api/rescheduler', authenticateToken, async (req, res) => {
    try {
        const { section } = req.query; // 'profile' or 'billing'
        
        if (!section) {
            return res.status(400).json({ error: 'Section parameter required' });
        }
        
        // Check if rescheduler_settings table exists, if not create it
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rescheduler_settings (
                id SERIAL PRIMARY KEY,
                section VARCHAR(50) UNIQUE NOT NULL,
                email_enabled BOOLEAN DEFAULT false,
                email VARCHAR(255),
                schedule_date DATE,
                schedule_time TIME,
                frequency VARCHAR(20) DEFAULT 'monthly',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const result = await pool.query(
            'SELECT * FROM rescheduler_settings WHERE section = $1',
            [section]
        );
        
        if (result.rows.length === 0) {
            // Return defaults
            return res.json({
                section: section,
                emailEnabled: false,
                email: '',
                date: '',
                time: '',
                frequency: 'monthly'
            });
        }
        
        const data = result.rows[0];
        res.json({
            section: data.section,
            emailEnabled: data.email_enabled || false,
            email: data.email || '',
            date: data.schedule_date ? data.schedule_date.toISOString().split('T')[0] : '',
            time: data.schedule_time ? data.schedule_time.substring(0, 5) : '',
            frequency: data.frequency || 'monthly'
        });
        
    } catch (err) {
        console.error('Rescheduler GET Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Rescheduler Settings
 */
app.post('/api/rescheduler', authenticateToken, async (req, res) => {
    try {
        const { section, emailEnabled, email, date, time, frequency } = req.body;
        
        if (!section) {
            return res.status(400).json({ error: 'Section parameter required' });
        }
        
        // Ensure table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rescheduler_settings (
                id SERIAL PRIMARY KEY,
                section VARCHAR(50) UNIQUE NOT NULL,
                email_enabled BOOLEAN DEFAULT false,
                email VARCHAR(255),
                schedule_date DATE,
                schedule_time TIME,
                frequency VARCHAR(20) DEFAULT 'monthly',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Upsert (insert or update)
        await pool.query(`
            INSERT INTO rescheduler_settings (section, email_enabled, email, schedule_date, schedule_time, frequency, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (section) 
            DO UPDATE SET 
                email_enabled = EXCLUDED.email_enabled,
                email = EXCLUDED.email,
                schedule_date = EXCLUDED.schedule_date,
                schedule_time = EXCLUDED.schedule_time,
                frequency = EXCLUDED.frequency,
                updated_at = NOW()
        `, [section, emailEnabled || false, email || null, date || null, time || null, frequency || 'monthly']);
        
        console.log(`✅ Rescheduler settings saved for section: ${section}`);
        res.json({ status: 'success', message: 'Rescheduler settings saved' });
        
    } catch (err) {
        console.error('Rescheduler POST Error:', err);
        res.status(500).json({ error: err.message });
    }
});
/* ==================================================
   👑 SUPER ADMIN: USER MANAGEMENT ROUTES
   ================================================== */

// Middleware to ensure the requester is an Admin


// 1. GET ALL USERS & THEIR DEVICES
// 1. GET ALL USERS (Updated to include Role & Plan)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
    SELECT 
        u.id, 
        u.email, 
        u.role, 
        u.plan, 
        u.created_at,
        u.is_blocked,              -- ✅ Added
        u.total_units_consumed,    -- ✅ Added
        COALESCE(json_agg(d.device_id) FILTER (WHERE d.device_id IS NOT NULL), '[]') as devices
    FROM users u
    LEFT JOIN devices d ON u.id = d.user_id
    GROUP BY u.id
    ORDER BY u.id ASC
`);
        res.json(result.rows);
    } catch (err) {
        console.error("Admin List Users Error:", err.message);
        res.status(500).json({ error: "Failed to fetch user list" });
    }
});

// 2. CREATE NEW USER (Manual Onboarding)
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and Password required" });
    }

    try {
        // Check if exists
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: "User already exists" });
        }

        // Hash Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // Insert
        const newUser = await pool.query(
            `INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id, email`,
            [email, hash]
        );

        console.log(`👑 Admin created new user: ${email}`);
        res.json({ success: true, user: newUser.rows[0] });

    } catch (err) {
        console.error("Create User Error:", err.message);
        res.status(500).json({ error: "Failed to create user" });
    }
});

// 3. DELETE USER (Ban)
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ success: true, message: "User deleted" });
    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 10000; 

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 NexusGrid Backend running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔒 Security: JWT authentication enabled`);
});
