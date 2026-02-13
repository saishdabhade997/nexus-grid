/**
 * ------------------------------------------------------------------
 * HARMONICS MODULE (Dynamic & Multi-Device)
 * ------------------------------------------------------------------
 * This script handles the Harmonic Spectrum Chart, THD Cards, and 
 * IEEE 519 Compliance alerts.
 * * TO SWITCH DEVICES EXTERNALLY:
 * Call window.updateHarmonicsDevice('meter_002') from your main script.
 */

// 1. CONFIGURATION & STATE
// ------------------------------------------------------------------
let currentDeviceId = 'meter_001'; // Default start
let activePhase = 'R';             // Default view (Red Phase)
let harmonicsInterval = null;      // Store timer to stop/start cleanly

// Store latest data snapshot
let harmonicData = {
    R: { spectrum: [], v_thd: 0, i_thd: 0 },
    Y: { spectrum: [], v_thd: 0, i_thd: 0 },
    B: { spectrum: [], v_thd: 0, i_thd: 0 },
    kFactor: 1.0,
    crestFactor: 1.41
};

// 2. CHART.JS INITIALIZATION
// ------------------------------------------------------------------
const ctx = document.getElementById('harmonicSpectrumChart').getContext('2d');

// Create a "Danger" Gradient (Red)
const gradientRed = ctx.createLinearGradient(0, 0, 0, 400);
gradientRed.addColorStop(0, 'rgba(239, 68, 68, 0.9)'); 
gradientRed.addColorStop(1, 'rgba(239, 68, 68, 0.1)');

// Create a "Safe" Gradient (Blue) - Optional for clean phases
const gradientBlue = ctx.createLinearGradient(0, 0, 0, 400);
gradientBlue.addColorStop(0, 'rgba(59, 130, 246, 0.9)'); 
gradientBlue.addColorStop(1, 'rgba(59, 130, 246, 0.1)');

const harmonicChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: Array.from({length: 21}, (_, i) => `H${i+1}`), // H1 to H21
        datasets: [{
            label: 'Voltage Harmonic Magnitude (%)',
            data: Array(21).fill(0),
            backgroundColor: gradientRed,
            borderRadius: 4,
            barPercentage: 0.6,
            categoryPercentage: 0.8
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#e2e8f0',
                bodyColor: '#fff',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                callbacks: { label: (c) => ` ${c.raw.toFixed(2)}%` }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 20, // Lock Y-axis to prevent jumping
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#64748b', font: { size: 10 } }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#64748b', font: { size: 10 } }
            }
        }
    }
});

// 3. CORE LOGIC: FETCH DATA
// ------------------------------------------------------------------
async function fetchHarmonicsData() {
    try {
        // Dynamic API Call using currentDeviceId
        const response = await fetch(`/api/telemetry/latest/${currentDeviceId}`);
        const data = await response.json();

        if (data.error) return; // Skip if ID is invalid or DB empty

        // Update State
        harmonicData.R = { 
            spectrum: data.harmonic_spectrum_r || [], 
            v_thd: parseFloat(data.v_thd_r || 0), 
            i_thd: parseFloat(data.i_thd_r || 0) 
        };
        harmonicData.Y = { 
            spectrum: data.harmonic_spectrum_y || [], 
            v_thd: parseFloat(data.v_thd_y || 0), 
            i_thd: parseFloat(data.i_thd_y || 0) 
        };
        harmonicData.B = { 
            spectrum: data.harmonic_spectrum_b || [], 
            v_thd: parseFloat(data.v_thd_b || 0), 
            i_thd: parseFloat(data.i_thd_b || 0) 
        };
        harmonicData.kFactor = parseFloat(data.k_factor || 1.0);
        harmonicData.crestFactor = parseFloat(data.crest_factor || 1.41);

        renderDashboard();

    } catch (err) {
        console.error(`Harmonics Fetch Error (${currentDeviceId}):`, err);
    }
}

// 4. CORE LOGIC: RENDER UI
// ------------------------------------------------------------------
function renderDashboard() {
    const phaseObj = harmonicData[activePhase];
    
    // A. Update Cards
    document.getElementById('live-thd-v').innerText = phaseObj.v_thd.toFixed(2) + '%';
    document.getElementById('live-thd-i').innerText = phaseObj.i_thd.toFixed(2) + '%';
    document.getElementById('live-k-factor').innerText = harmonicData.kFactor.toFixed(2);
    document.getElementById('live-crest').innerText = harmonicData.crestFactor.toFixed(2);

    // B. IEEE 519 Safety Alert
    const statusEl = document.getElementById('status-thd-v');
    if (phaseObj.v_thd > 5.0) {
        statusEl.innerHTML = "⚠️ IEEE 519 <b>VIOLATION</b>";
        statusEl.className = "mt-2 text-[9px] font-black text-red-500 uppercase animate-pulse";
    } else {
        statusEl.innerHTML = "✅ IEEE 519 <b>COMPLIANT</b>";
        statusEl.className = "mt-2 text-[9px] font-black text-emerald-400 uppercase";
    }

    // C. Current THD Bar
    const iBar = document.getElementById('bar-thd-i');
    const width = Math.min(phaseObj.i_thd * 3, 100);
    iBar.style.width = `${width}%`;
    iBar.className = phaseObj.i_thd > 15 
        ? "h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-all duration-500" 
        : "h-full bg-emerald-500 transition-all duration-500";

    // D. Update Chart
    harmonicChart.data.datasets[0].data = phaseObj.spectrum;
    
    // Dynamic Color Switching
    let color = '#ef4444'; // Red
    if (activePhase === 'Y') color = '#eab308'; // Yellow
    if (activePhase === 'B') color = '#3b82f6'; // Blue

    harmonicChart.data.datasets[0].backgroundColor = color;
    harmonicChart.update('none'); // Update without full redraw
}

// 5. INTERACTION: SWITCH PHASE (R, Y, B Buttons)
// ------------------------------------------------------------------
function setPhase(phase) {
    activePhase = phase;
    renderDashboard();
    
    // Update Button Styles
    ['R', 'Y', 'B'].forEach(p => {
        const btn = document.getElementById(`btn-phase-${p}`);
        // Reset
        btn.className = "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase text-slate-400 bg-transparent border border-transparent hover:text-white transition-all";
        
        // Highlight Active
        if (p === activePhase) {
            btn.className = "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase text-white shadow-lg transition-all transform scale-105 border border-white/10";
            if (p === 'R') btn.classList.add('bg-red-600');
            if (p === 'Y') btn.classList.add('bg-yellow-500');
            if (p === 'B') btn.classList.add('bg-blue-600');
        }
    });
}

// 6. EXTERNAL CONTROL: SWITCH DEVICE (For Main Dashboard)
// ------------------------------------------------------------------
// Call this function from your main dashboard dropdown!
// Example: window.updateHarmonicsDevice('meter_002');
window.updateHarmonicsDevice = function(newDeviceId) {
    if (newDeviceId === currentDeviceId) return; // No change

    console.log(`Harmonics switching to: ${newDeviceId}`);
    currentDeviceId = newDeviceId;

    // 1. Reset Data Visuals (User Feedback)
    harmonicChart.data.datasets[0].data = Array(21).fill(0);
    harmonicChart.update();
    document.getElementById('live-thd-v').innerText = "--";
    
    // 2. Restart Polling
    clearInterval(harmonicsInterval);
    fetchHarmonicsData(); // Fetch immediately
    harmonicsInterval = setInterval(fetchHarmonicsData, 2000); // Resume loop
};

// 7. INITIALIZE
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check URL for ID (Optional override)
    const urlParams = new URLSearchParams(window.location.search);
    if(urlParams.get('id')) currentDeviceId = urlParams.get('id');

    // 2. Start Logic
    fetchHarmonicsData();
    harmonicsInterval = setInterval(fetchHarmonicsData, 2000);
    
    // 3. Set Initial Buttons
    setPhase('R');
});
