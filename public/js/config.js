/* ============================================================
   GLOBAL CONFIGURATION & STATE
   ============================================================ */
console.log("⚙️ Loading Configuration...");
window.API_URL = "https://nexusgrid-api.onrender.com/api";
window.API_BASE_URL = "https://nexusgrid-api.onrender.com/api";

// Socket.io connection (Attached to window for global access)
// ⚠️ CHANGE THIS URL to your Render Link
window.socket = io('https://nexusgrid-api.onrender.com', {
    transports: ['websocket', 'polling'], // 'websocket' first is faster
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    secure: true, // Important for HTTPS
});

// 2. Visual Configs
window.CONFIG = {
    bgGrid: '#334155',
    colorActive: '#3b82f6',
    colorApparent: '#a855f7'
};

// 3. Global Data Containers
window.fullAuditData = [];       // Critical for PDF/CSV exports
window.billingUpdateTimeout = null;
window.activeThreats = new Map(); // Stores active alarms

// 4. Chart Instances (Placeholders)
window.mainAnalyticsChart = null;
window.correlationChartInstance = null;
window.loadDensityChart = null;
window.comparisonChart = null;

// 5. App State
window.ACTIVE_METER_ID = localStorage.getItem('lastMeterId') || null;
window.isLiveMode = true;
window.currentPage = 1;
window.itemsPerPage = 25;
window.currentArchivePage = 1;



window.currentThresholds = {
    vOV: 456, vUV: 373, vImb: 3,
    iOC: 110, iImb: 15, iNeu: 40,
    allottedLoad: 500, pfCrit: 0.90
};

// 7. Report Column Definitions (Required for Reporting Tab)
window.ALL_COLUMNS = [
    // 1. Time (Locked)
    { id: 'timestamp', label: 'Timestamp', locked: true, selected: true },

    // 2. Voltages
    { id: 'voltage_r', label: 'Voltage R (V)', selected: true },
    { id: 'voltage_y', label: 'Voltage Y (V)', selected: false },
    { id: 'voltage_b', label: 'Voltage B (V)', selected: false },
    { id: 'v_thd_r', label: 'V-THD R (%)', selected: false },
    { id: 'v_thd_y', label: 'V-THD Y (%)', selected: false },
    { id: 'v_thd_b', label: 'V-THD B (%)', selected: false },

    // 3. Currents
    { id: 'current_r', label: 'Current R (A)', selected: true },
    { id: 'current_y', label: 'Current Y (A)', selected: false },
    { id: 'current_b', label: 'Current B (A)', selected: false },
    { id: 'current_n', label: 'Current Neutral (A)', selected: false },
    { id: 'i_thd_r', label: 'I-THD R (%)', selected: false },
    { id: 'i_thd_y', label: 'I-THD Y (%)', selected: false },
    { id: 'i_thd_b', label: 'I-THD B (%)', selected: false },

    // 4. Power
    { id: 'active_power', label: 'Active Power (kW)', selected: true },
    { id: 'apparent_power', label: 'Apparent Power (kVA)', selected: true },
    { id: 'reactive_power', label: 'Reactive Power (kVAr)', selected: true },
    { id: 'power_factor', label: 'Power Factor', selected: true },
    { id: 'frequency', label: 'Frequency (Hz)', selected: true },

    // 5. Energy Counters
    { id: 'energy_kwh', label: 'Energy Active (kWh)', selected: false },
    { id: 'energy_kvah', label: 'Energy Apparent (kVAh)', selected: false },
    { id: 'energy_kvarh', label: 'Energy Reactive (kVArh)', selected: false },

    // 6. Device Health
    { id: 'meter_temperature', label: 'Meter Temp (°C)', selected: false }
];

