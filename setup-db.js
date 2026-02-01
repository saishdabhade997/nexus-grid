require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const sql = `
-- ⚠️ RESET: Delete old tables to ensure new columns are added
DROP TABLE IF EXISTS alarm_logs CASCADE;
DROP TABLE IF EXISTS telemetry CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS rescheduler_settings CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- 1. USERS
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    plan VARCHAR(50) DEFAULT 'essential',
    is_admin BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    reset_token VARCHAR(255),
    reset_expires TIMESTAMP,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. DEVICES (Updated with THD & Frequency Limits)
CREATE TABLE devices (
    device_id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    device_name VARCHAR(255),
    
    -- Voltage Safety
    v_ov NUMERIC DEFAULT 456,   -- Over Voltage
    v_uv NUMERIC DEFAULT 373,   -- Under Voltage
    v_imb NUMERIC DEFAULT 3,    -- Voltage Imbalance %
    v_thd_limit NUMERIC DEFAULT 5, -- ⚠️ Voltage THD Limit % (ADDED)
    
    -- Current Safety
    i_oc NUMERIC DEFAULT 110,   -- Over Current
    i_imb NUMERIC DEFAULT 15,   -- Current Imbalance %
    i_neu NUMERIC DEFAULT 30,   -- Neutral Current
    i_thd_limit NUMERIC DEFAULT 15, -- ⚠️ Current THD Limit % (ADDED)
    
    -- Frequency & Thermal
    freq_max NUMERIC DEFAULT 50.5, -- ⚠️ Max Frequency (ADDED)
    freq_min NUMERIC DEFAULT 49.5, -- ⚠️ Min Frequency (ADDED)
    t_int NUMERIC DEFAULT 75,   -- Max Temp
    
    -- Capacity
    allotted_load NUMERIC DEFAULT 500, -- Max kVA
    pf_lag NUMERIC DEFAULT 0.90,       -- Min Lagging PF
    pf_lead NUMERIC DEFAULT 0.95,      -- Min Leading PF
    
    -- Alerts
    alert_email VARCHAR(255),
    enable_email_alerts BOOLEAN DEFAULT TRUE,
    tariff_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. TELEMETRY
CREATE TABLE telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(device_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Raw Vectors
    voltage_r NUMERIC, voltage_y NUMERIC, voltage_b NUMERIC,
    current_r NUMERIC, current_y NUMERIC, current_b NUMERIC, current_n NUMERIC,
    
    -- Power & Energy
    active_power NUMERIC,    -- kW
    apparent_power NUMERIC,  -- kVA
    reactive_power NUMERIC,  -- kVAR
    power_factor NUMERIC,    -- PF
    frequency NUMERIC,
    energy_kwh NUMERIC, 
    energy_kvah NUMERIC, 
    energy_kvarh NUMERIC,
    
    -- Quality & Harmonics
    v_thd_r NUMERIC, v_thd_y NUMERIC, v_thd_b NUMERIC,
    i_thd_r NUMERIC, i_thd_y NUMERIC, i_thd_b NUMERIC,
    meter_temperature NUMERIC,
    
    -- Full Spectrum (H1-H21)
    harmonics_json JSONB DEFAULT '[]'::jsonb
);

-- 4. ALARM LOGS
CREATE TABLE alarm_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(device_id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    alarm_type VARCHAR(50),  -- e.g., 'THD_HIGH', 'FREQ_LOW'
    alarm_level VARCHAR(20), 
    message TEXT,
    value_at_time NUMERIC,
    threshold_limit NUMERIC
);

-- 5. RESCHEDULER SETTINGS
CREATE TABLE rescheduler_settings (
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

-- 6. SYSTEM SETTINGS
CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    data_retention_days INTEGER DEFAULT 30
);

-- 7. SEED DATA (Admin User)
INSERT INTO system_settings (id, data_retention_days) VALUES (1, 30) ON CONFLICT (id) DO NOTHING;

INSERT INTO users (email, password_hash, role, is_admin, plan, created_at)
VALUES ('admin@nexusgrid.com', '$2b$10$tJ.9.9.9.9.9.9.9.9.9.9e9e9e9e9e9e9e9e9e9e9e9e9e9e9', 'admin', TRUE, 'enterprise', NOW())
ON CONFLICT (email) DO NOTHING;
`;

pool.query(sql)
    .then(() => { 
        console.log('✅ SUCCESS: Database has been RESET and upgraded with THD/Frequency limits!'); 
        process.exit(0); 
    })
    .catch(e => { 
        console.error(e); 
        process.exit(1); 
    });