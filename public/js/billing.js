/* ============================================================
   NEXUSGRID HARMONICS & PQ ENGINE v1.0 (Physics Core)
   ============================================================ */

window.LIVE_PQ = { thdV: 0, thdI: 0, kFactor: 1.0, crest: 1.41 };
window.ACTIVE_PHASE = 'R'; // Default Phase
window.spectrumChart = null;
window.complianceLog = []; // Stores violations for export
window.isAnalysisLoading = false;

// IEEE 519 THRESHOLDS (Configurable)
const IEEE_LIMITS = {
    VOLTAGE_THD: 5.0, // Max 5% THD-V allowed
    CURRENT_THD: 8.0  // Max 8% THD-I allowed
};

/* ------------------------------------------------------------
   1. LIVE TELEMETRY PROCESSOR (Socket Listener)
   ------------------------------------------------------------ */
window.handleLiveBillingUpdate = function(d) {
    // 1. Extract or Simulate PQ Metrics
    // Real meters send: d.thd_voltage_r, d.thd_current_r, etc.
    // Fallback: Simulation for UI testing if raw data missing.
    
    const phaseKey = window.ACTIVE_PHASE.toLowerCase();
    
    // Voltage Distortion (THD-V)
    const rawThdV = Number(d[`thd_voltage_${phaseKey}`]) || Number(d.thd_voltage);
    const thdV = !isNaN(rawThdV) ? rawThdV : (Math.random() * 1.5 + 1.5); // Sim: 1.5% - 3.0%

    // Current Distortion (THD-I)
    const rawThdI = Number(d[`thd_current_${phaseKey}`]) || Number(d.thd_current);
    const thdI = !isNaN(rawThdI) ? rawThdI : (Math.random() * 4 + 3); // Sim: 3% - 7%

    // K-Factor (Transformer Heating) - Simulating rise with THD-I
    const kFactor = 1.0 + (thdI * 0.05); 

    // Crest Factor (Waveform Peak/RMS) - Pure Sine is 1.41
    const crest = 1.41 + (thdV * 0.02);

    // 2. Update Live Gauges
    safeSetText('live-thd-v', `${thdV.toFixed(2)}%`);
    safeSetText('live-thd-i', `${thdI.toFixed(2)}%`);
    safeSetText('live-k-factor', kFactor.toFixed(2));
    safeSetText('live-crest', crest.toFixed(2));

    // 3. Update Visual Bars (Scale: 20% is full bar)
    const barThd = document.getElementById('bar-thd-i');
    if (barThd) barThd.style.width = `${Math.min(100, thdI * 5)}%`;

    // 4. Run Compliance Engine
    checkIEEECompliance(thdV, thdI);

    // 5. Update Spectrum Visualizer (H1 - H21)
    // If telemetry sends 'harmonics': [100, 2, 5...] use it.
    // Otherwise, calculate a physics-based decay curve.
    const harmonicArray = d.harmonics || calculateHarmonicDecay(thdV, thdI);
    updateSpectrumChart(harmonicArray);
};

/* ------------------------------------------------------------
   2. SPECTRUM VISUALIZER (Chart.js)
   ------------------------------------------------------------ */
function updateSpectrumChart(dataArray) {
    const ctx = document.getElementById('harmonicSpectrumChart')?.getContext('2d');
    if (!ctx) return;

    // Labels H1 to H21
    const labels = Array.from({length: 21}, (_, i) => `H${i+1}`);
    
    // Industrial Color Logic
    // H1 (Fundamental) = Blue
    // Triplens (H3, H9, H15) = Red (Neutral Current Risk)
    // Other Odd (H5, H7) = Purple (VFD/Drive Risk)
    // Even = Gray (Uncommon)
    const colors = labels.map((_, i) => {
        const order = i + 1;
        if (order === 1) return '#3b82f6'; 
        if (order % 3 === 0) return '#ef4444'; // Triplen (Bad for Neutral)
        if (order % 2 !== 0) return '#a855f7'; // Odd
        return '#475569'; // Even
    });

    if (window.spectrumChart) {
        // Performance Update (No Animation)
        window.spectrumChart.data.datasets[0].data = dataArray;
        window.spectrumChart.data.datasets[0].backgroundColor = colors;
        window.spectrumChart.update('none'); 
    } else {
        // Init Chart
        window.spectrumChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Magnitude (%)',
                    data: dataArray,
                    backgroundColor: colors,
                    borderRadius: 3,
                    barPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Critical for real-time performance
                plugins: { legend: { display: false } },
                scales: {
                    y: { 
                        beginAtZero: true, 
                        max: 15, // Zoom in on harmonics (Clip H1)
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', font: {family: 'monospace'} }
                    },
                    x: { 
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: {size: 10, family: 'monospace'} }
                    }
                }
            }
        });
    }
}

/* ------------------------------------------------------------
   3. COMPLIANCE & SAFETY ENGINE
   ------------------------------------------------------------ */
function checkIEEECompliance(thdV, thdI) {
    const statusEl = document.getElementById('status-thd-v');
    const logBody = document.getElementById('compliance-log-body');
    
    // IEEE 519 Violation Logic
    let violationType = null;
    let magnitude = 0;

    if (thdV > IEEE_LIMITS.VOLTAGE_THD) {
        violationType = "VOLTAGE THD";
        magnitude = thdV;
    } else if (thdI > IEEE_LIMITS.CURRENT_THD) {
        violationType = "CURRENT THD";
        magnitude = thdI;
    }

    // UI Feedback
    if (violationType) {
        if(statusEl) {
            statusEl.innerText = "⚠️ VIOLATION ACTIVE";
            statusEl.className = "mt-2 text-[9px] font-black text-red-500 uppercase animate-pulse";
        }
        
        // Log to Table (Throttle: Max 1 log per 3 seconds to avoid spam)
        const now = Date.now();
        if (!window.lastLogTime || (now - window.lastLogTime > 3000)) {
            window.lastLogTime = now;
            
            const rowHtml = `
                <tr class="bg-red-500/5 border-b border-red-500/10 animate-fade-in">
                    <td class="p-4 text-slate-400 font-mono text-xs">${new Date().toLocaleTimeString()}</td>
                    <td class="p-4 font-bold text-red-400 text-xs">${violationType} LIMIT</td>
                    <td class="p-4 text-center font-mono text-white text-xs">${magnitude.toFixed(2)}%</td>
                    <td class="p-4 text-right text-slate-500 text-xs">Exceeded ${violationType === 'VOLTAGE THD' ? '5%' : '8%'}</td>
                </tr>`;
                
            if(logBody) {
                logBody.insertAdjacentHTML('afterbegin', rowHtml);
                // Keep table clean (Max 50 rows)
                if (logBody.children.length > 50) logBody.lastElementChild.remove();
            }
            
            // Add to Export Array
            window.complianceLog.push({
                Time: new Date().toLocaleString(),
                Type: violationType,
                Value: magnitude.toFixed(2) + '%',
                Phase: window.ACTIVE_PHASE
            });
        }
    } else {
        if(statusEl) {
            statusEl.innerText = "IEEE 519 COMPLIANT";
            statusEl.className = "mt-2 text-[9px] font-black text-emerald-400 uppercase";
        }
    }
}

/* ------------------------------------------------------------
   4. PHYSICS SIMULATION (If Raw Array is Missing)
   ------------------------------------------------------------ */
function calculateHarmonicDecay(thdV, thdI) {
    // Generates a realistic industrial spectrum based on Total THD
    // H1 is Fundamental (not shown fully on zoomed scale)
    const harmonics = [100]; 
    
    // Simulate typical 6-pulse drive signature (High 5th, 7th)
    // Simulate typical IT load signature (High 3rd)
    const baseNoise = thdV / 2; 

    for (let h = 2; h <= 21; h++) {
        let amp = 0;
        
        // Odd Harmonics (The dangerous ones)
        if (h % 2 !== 0) {
            // Decay formula: Amplitude ~ 1/h
            let factor = 1 / h;
            
            // Boost specific orders common in infrastructure
            if (h === 3) factor *= 1.5; // Triplen (Servers)
            if (h === 5) factor *= 2.0; // 6-Pulse Drives
            
            amp = (baseNoise * factor * 5) + (Math.random() * 0.5);
        } else {
            // Even Harmonics (Usually negligible)
            amp = Math.random() * 0.2;
        }
        
        harmonics.push(amp);
    }
    return harmonics;
}

/* ------------------------------------------------------------
   5. UTILITIES & CONTROLS
   ------------------------------------------------------------ */
function safeSetText(id, val) {
    const el = document.getElementById(id);
    if(el) el.innerText = val;
}

// Phase Switcher Logic
window.setPhase = function(p) {
    window.ACTIVE_PHASE = p;
    
    // Reset Buttons
    ['R','Y','B'].forEach(ph => {
        const btn = document.getElementById(`btn-phase-${ph}`);
        if(btn) {
            if (ph === p) {
                // Active State Colors
                const color = p === 'R' ? 'bg-red-600' : (p === 'Y' ? 'bg-yellow-600' : 'bg-blue-600');
                btn.className = `px-4 py-1.5 rounded-lg text-[10px] font-black uppercase text-white transition-all ${color}`;
            } else {
                // Inactive State
                btn.className = "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase text-slate-400 hover:text-white transition-all";
            }
        }
    });
    
    // Clear Chart to indicate switch
    if(window.spectrumChart) {
        window.spectrumChart.data.datasets[0].data = Array(21).fill(0);
        window.spectrumChart.update();
    }
};

window.clearLogs = function() {
    const tbody = document.getElementById('compliance-log-body');
    if(tbody) tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-600 text-xs italic">Log Cleared. Monitoring...</td></tr>';
    window.complianceLog = [];
};

window.exportPowerExcel = function() {
    if (window.complianceLog.length === 0) {
        alert("No violations recorded to export.");
        return;
    }
    const ws = XLSX.utils.json_to_sheet(window.complianceLog);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IEEE_519_Violations");
    XLSX.writeFile(wb, `NexusGrid_Harmonics_${new Date().toISOString().slice(0,10)}.xlsx`);
};

/* ------------------------------------------------------------
   6. INIT
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
    console.log('⚡ NexusGrid Harmonics Engine Initialized');
    // Set initial phase
    window.setPhase('R');
});
window.clearLogs = function() {
    console.log("Clearing Logs...");
    const tbody = document.getElementById('compliance-log-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-600 text-xs italic">Log Cleared. Monitoring...</td></tr>';
    }
    // Reset internal memory
    if (window.complianceLog) window.complianceLog = [];
};