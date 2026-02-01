/* ====== CONFIG & GLOBALS ====== */
const API_URL = 'http://localhost:3000/api';

// Socket.io connection
const socket = io('http://localhost:3000', {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
});

const CONFIG = {
  bgGrid: '#334155',
  colorActive: '#3b82f6',
  colorApparent: '#a855f7'
};

// Chart instances (will be initialized in charts.js)
let billingUpdateTimeout = null;
let mainAnalyticsChart = null;
let correlationChartInstance = null;
let loadDensityChart = null;
let comparisonChart = null;

// Data & UI state
let fullAuditData = [];
let currentPage = 1;
const itemsPerPage = 25;
let cumulativeCost = 0;
let isLiveMode = true;

// Active alarms map
let activeThreats = new Map();

// Tariff & thresholds
let TARIFF_CONFIG = {
  shifts: {
    A: { start: 6, end: 14, rate: 7.50 },
    B: { start: 14, end: 22, rate: 11.20 },
    C: { start: 22, end: 6, rate: 5.80 }
  },
  fixed: { contractDemand: 500, demandCharge: 280, tax: 18 }
};

let currentThresholds = {
  vOV: 456, vUV: 373, vImb: 3,
  iOC: 110, iImb: 15, iNeu: 40,
  allottedLoad: 500, pfCrit: 0.90
};

window.currentArchivePage = 1;

// Global state: Multi-meter
let ACTIVE_METER_ID = localStorage.getItem('lastMeterId') || 'meter_01';
