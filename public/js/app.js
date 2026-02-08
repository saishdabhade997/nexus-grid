/* ====== MAIN APPLICATION LOGIC ====== */

/* ====== UTILITIES ====== */
function getUnit(key) {
  const k = (key || '').toLowerCase();
  if (k.includes('voltage')) return ' V';
  if (k.includes('current')) return ' A';
  if (k.includes('power') && !k.includes('kwh')) return ' kW';
  if (k.includes('kwh') || k.includes('energy')) return ' kWh';
  if (k.includes('freq')) return ' Hz';
  if (k.includes('temp')) return ' °C';
  return '';
}
// Function to Save System Settings
async function saveSystemSettings() {
    const btn = document.getElementById('save-sys-btn');
    const originalText = btn.innerText;
    
    // 1. Capture Values
    const settings = {
        alertsEnabled: document.getElementById('enable-alerts').checked,
        alertEmail: document.getElementById('alert-email').value,
        dataPersistence: document.getElementById('persist-data').checked, // NEW FIELD
        retentionDays: document.getElementById('retention-days').value
    };

    // UI Feedback (Loading)
    btn.innerText = "SAVING...";
    btn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        
        // 2. Send to Backend
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(settings)
        });

        if (res.ok) {
            alert("✅ System Kernel Updated Successfully");
        } else {
            const err = await res.json();
            throw new Error(err.error || "Failed to save settings");
        }
    } catch (err) {
        console.error(err);
        alert("❌ Error: " + err.message);
    } finally {
        // UI Feedback (Reset)
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function updateManual(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = value;
  el.classList.remove('skeleton');
  el.style.color = '#60a5fa';
  setTimeout(() => { el.style.color = ''; }, 300);
}

/* ====== HEATMAP ====== */
function generateHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const totalCells = 168;
  for (let i = 0; i < totalCells; i++) {
    const div = document.createElement('div');
    div.id = `hm-cell-${i}`;
    div.className = 'w-full h-4 rounded-sm transition-colors duration-500 bg-slate-800 border border-transparent';
    div.title = 'No Data';
    grid.appendChild(div);
  }
}
/* ============================================================
   DEMAND FORECAST ENGINE (Linear Projection)
   ============================================================ */
let forecastHistory = []; // Store last 10 readings to calculate trend

window.updateDemandForecast = function(currentLoad) {
    const forecastEl = document.getElementById('forecast-val');
    const trendIcon = document.getElementById('forecast-icon');
    const trendText = document.getElementById('forecast-trend');

    if (!forecastEl) return;

    // 1. Add new reading to history
    forecastHistory.push(currentLoad);
    if (forecastHistory.length > 10) forecastHistory.shift(); // Keep last 10

    // 2. Calculate Trend (Simple Linear Slope)
    // If history is empty, assume stable
    let slope = 0;
    if (forecastHistory.length >= 2) {
        const first = forecastHistory[0];
        const last = forecastHistory[forecastHistory.length - 1];
        slope = last - first;
    }

    // 3. Generate Prediction (Current + Trend Impact)
    // We project 15 mins into the future based on current momentum
    const predictedLoad = currentLoad + (slope * 1.5); 

    // 4. Update UI
    // Ensure we don't show negative numbers
    const finalDisplay = Math.max(0, predictedLoad).toFixed(1);
    forecastEl.innerText = `${finalDisplay} kVA`;

    // 5. Visual Feedback (Arrows & Colors)
    if (slope > 5) {
        // Rapidly Rising
        if (trendIcon) trendIcon.className = "fas fa-arrow-trend-up text-red-500 animate-pulse";
        if (trendText) { trendText.innerText = "Rising Fast"; trendText.className = "text-[10px] font-bold text-red-500 uppercase"; }
    } else if (slope > 0.5) {
        // Slowly Rising
        if (trendIcon) trendIcon.className = "fas fa-arrow-trend-up text-yellow-500";
        if (trendText) { trendText.innerText = "Trending Up"; trendText.className = "text-[10px] font-bold text-yellow-500 uppercase"; }
    } else if (slope < -5) {
        // Rapidly Falling
        if (trendIcon) trendIcon.className = "fas fa-arrow-trend-down text-emerald-500";
        if (trendText) { trendText.innerText = "Dropping Fast"; trendText.className = "text-[10px] font-bold text-emerald-500 uppercase"; }
    } else if (slope < -0.5) {
        // Slowly Falling
        if (trendIcon) trendIcon.className = "fas fa-arrow-trend-down text-blue-400";
        if (trendText) { trendText.innerText = "Cooling Down"; trendText.className = "text-[10px] font-bold text-blue-400 uppercase"; }
    } else {
        // Stable
        if (trendIcon) trendIcon.className = "fas fa-minus text-gray-500";
        if (trendText) { trendText.innerText = "Stable"; trendText.className = "text-[10px] font-bold text-gray-500 uppercase"; }
    }
};
function updateLiveHeatmap(intensity) {
  const totalCells = 168;
  const idx = totalCells - 1;
  const cell = document.getElementById(`hm-cell-${idx}`);
  if (!cell) return;
  if (intensity > 0.9) cell.className = "w-full h-4 rounded-sm transition-colors duration-300 bg-green-400 shadow-[0_0_15px_#4ade80] border border-white animate-pulse";
  else if (intensity > 0.7) cell.className = "w-full h-4 rounded-sm transition-colors duration-300 bg-green-500 border border-white";
  else if (intensity > 0.4) cell.className = "w-full h-4 rounded-sm transition-colors duration-300 bg-green-700 border border-white";
  else cell.className = "w-full h-4 rounded-sm transition-colors duration-300 bg-green-950 border border-white";
}
function toggleAlarmView(view) {
    const views = {
        dashboard: document.getElementById('alarm-view-dashboard'),
        archive: document.getElementById('alarm-view-archive'),
        settings: document.getElementById('alarm-view-settings')
    };

    const buttons = {
        dashboard: document.getElementById('btn-alarm-dash'),
        archive: document.getElementById('btn-alarm-arch'),
        settings: document.getElementById('btn-alarm-sett')
    };

    const slider = document.getElementById('alarm-nav-slider');

    // 1. Reset all views and button text colors
    Object.values(views).forEach(v => v?.classList.add('hidden'));
    Object.values(buttons).forEach(b => {
        if(b) b.classList.replace('text-white', 'text-gray-500');
    });

    // 2. Show the selected view and highlight button
    if (views[view]) views[view].classList.remove('hidden');
    if (buttons[view]) buttons[view].classList.replace('text-gray-500', 'text-white');

    // 3. Precise Slider Positioning
    if (view === 'dashboard') slider.style.transform = "translateX(0)";
    if (view === 'archive')   slider.style.transform = "translateX(140px)";
    if (view === 'settings')  slider.style.transform = "translateX(280px)";
}


 
/* ====== SOCKET.IO LISTENERS ====== */
function startLiveStream() {
  try {
     socket.on('connect', () => {
            console.log('✅ Socket Connected');
            const dot = document.getElementById('conn-dot');
            const text = document.getElementById('conn-text');
            if (dot) {
                dot.className = 'w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]';
            }
            if (text) {
                text.innerText = 'SYSTEM ONLINE';
                text.className = 'text-xs font-mono text-green-400';
            }
        });

        socket.on('disconnect', () => {
            console.warn(' Socket Disconnected');
            const dot = document.getElementById('conn-dot');
            const text = document.getElementById('conn-text');
            if (dot) {
                dot.className = 'w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444] animate-pulse';
            }
            if (text) {
                text.innerText = 'CONNECTION LOST';
                text.className = 'text-xs font-mono text-red-400';
            }
        });

        socket.on('connect_error', (error) => {
            console.error(' Socket Error:', error);
        });

        socket.on('new-data', (data) => {
            // Validation
            if (!data || typeof data !== 'object') {
                console.warn('⚠️ Invalid socket data received:', data);
                return;
            }
            
            // Filter by active meter
            const packetId = data.device_id || 'meter_01';
            if (packetId !== ACTIVE_METER_ID) {
                return; // Stop. Do not update UI.
            }
            
            // Defensive defaults
            const safeData = {
                voltage_r: Number(data.voltage_r || 0),
                voltage_y: Number(data.voltage_y || 0),
                voltage_b: Number(data.voltage_b || 0),
                current_r: Number(data.current_r || 0),
                current_y: Number(data.current_y || 0),
                current_b: Number(data.current_b || 0),
                current_n: Number(data.current_n || 0),
                active_power: Number(data.active_power || 0),
                apparent_power: Number(data.apparent_power || 0),
                reactive_power: Number(data.reactive_power || 0),
                power_factor: Number(data.power_factor || 0),
                frequency: Number(data.frequency || 50.0),
                energy_kwh: Number(data.energy_kwh || 0),
                energy_kvah: Number(data.energy_kvah || 0),
                energy_kvarh: Number(data.energy_kvarh || 0),
                meter_temperature: Number(data.meter_temperature || 0),
                v_thd_r: Number(data.v_thd_r || 0),
                v_thd_y: Number(data.v_thd_y || 0),
                v_thd_b: Number(data.v_thd_b || 0),
                i_thd_r: Number(data.i_thd_r || 0),
                i_thd_y: Number(data.i_thd_y || 0),
                i_thd_b: Number(data.i_thd_b || 0)
            };
            
            try {
                if (typeof updateDemandForecast === 'function') {
                    updateDemandForecast(safeData.apparent_power);
                }
            } catch (forecastErr) {
                console.error(' Forecast error:', forecastErr);
            }
          
            // Mapping: Create dual-access object
            const mappedData = {
                ...safeData,
                'activePower': safeData.active_power,
                'apparentPower_total': safeData.apparent_power,
                'reactivePower_total': safeData.reactive_power,
                'powerFactor_avg': safeData.power_factor,
                'vthd_r': safeData.v_thd_r,
                'vthd_y': safeData.v_thd_y,
                'vthd_b': safeData.v_thd_b,
                'ithd_r': safeData.i_thd_r,
                'ithd_y': safeData.i_thd_y,
                'ithd_b': safeData.i_thd_b,
                'powerThd_r': safeData.i_thd_r,
                'powerThd_y': safeData.i_thd_y,
                'powerThd_b': safeData.i_thd_b,
                'meterTemperature': safeData.meter_temperature,
                'import_kwh': safeData.energy_kwh,
                'apparent_kvah': safeData.energy_kvah,
                'reactive_kvarh': safeData.energy_kvarh,
                'frequency_display': safeData.frequency
            };

            // Update DOM
            Object.keys(mappedData).forEach(key => {
                const el = document.getElementById(key);
                if (el && mappedData[key] !== undefined) {
                    el.classList.remove('skeleton');
                    const unit = getUnit(key);
                    const val = mappedData[key];
                    
                    if (!isNaN(val)) {
                        let decimals = 2;
                        if (key.includes('Factor') || key.includes('factor')) decimals = 3;
                        if (key.includes('thd') || key.includes('THD') || key.includes('Temperature')) decimals = 1;
                        
                        el.innerText = `${val.toFixed(decimals)}${unit}`;
                    } else {
                        el.innerText = `${val}${unit}`;
                    }
                    
                    // Visual flash effect
                    el.style.color = '#3b82f6';
                    setTimeout(() => el.style.color = '', 300);
                }
            });

            // Manual calculations: Average Voltage
            if (safeData.voltage_r > 0) {
                const avgLn = (safeData.voltage_r + safeData.voltage_y + safeData.voltage_b) / 3;
                const avgLl = avgLn * 1.732; // Line-to-Line calculation
                
                updateManual('voltage_ln_avg', avgLn.toFixed(1) + ' V');
                updateManual('voltage_ln_avg_disp', avgLn.toFixed(1) + ' V');
                updateManual('voltage_ll_avg', avgLl.toFixed(1) + ' V');
                
                // Calculate voltage imbalance
                const maxDev = Math.max(
                    Math.abs(safeData.voltage_r - avgLn),
                    Math.abs(safeData.voltage_y - avgLn),
                    Math.abs(safeData.voltage_b - avgLn)
                );
                const vImb = (maxDev / avgLn) * 100;
                updateManual('v_imbalance', vImb.toFixed(1) + ' %');
            }

            // Charts update
            const now = new Date().toLocaleTimeString();
            if (isLiveMode && mainAnalyticsChart) {
                try {
                    mainAnalyticsChart.data.labels.push(now);
                    mainAnalyticsChart.data.datasets[0].data.push(safeData.active_power);
                    mainAnalyticsChart.data.datasets[1].data.push(safeData.apparent_power);
                    
                    // Keep only last 50 points
                    if (mainAnalyticsChart.data.labels.length > 50) {
                        mainAnalyticsChart.data.labels.shift();
                        mainAnalyticsChart.data.datasets[0].data.shift();
                        mainAnalyticsChart.data.datasets[1].data.shift();
                    }
                    mainAnalyticsChart.update('none');
                } catch (chartErr) {
                    console.error(' Chart update failed:', chartErr);
                }
            }

            // Correlation chart
            if (correlationChartInstance) {
                try {
                    correlationChartInstance.data.datasets[0].data.push({
                        x: safeData.voltage_r,
                        y: safeData.power_factor
                    });
                    if (correlationChartInstance.data.datasets[0].data.length > 200) {
                        correlationChartInstance.data.datasets[0].data.shift();
                    }
                    correlationChartInstance.update('none');
                } catch (corrErr) {
                    console.error(' Correlation chart error:', corrErr);
                }
            }
        if (typeof window.handleLiveBillingUpdate === 'function') {
        window.handleLiveBillingUpdate(data);
    }
            // Heatmap update
            try {
                const intensity = safeData.apparent_power / 500;
                updateLiveHeatmap(Math.min(intensity, 1.0));
            } catch (heatErr) {
                console.error(' Heatmap error:', heatErr);
            }

            // Safety evaluation
            try {
                if (typeof evaluateSafety === 'function') {
                    evaluateSafety(safeData);
                }
            } catch (safetyErr) {
                console.error(' Safety evaluation error:', safetyErr);
            }
        });
  } catch (err) {
    console.error('startLiveStream error', err);
  }
}

// 2. Render Checkboxes inside the Dropdown
window.renderColumnSelector = function() {
    const list = document.getElementById('column-list');
    if (!list) return;

    list.innerHTML = ''; // Clear previous items

    ALL_COLUMNS.forEach((col) => {
        // Container
        const item = document.createElement('div');
        item.className = "flex items-center gap-3 p-2 hover:bg-slate-700/50 rounded cursor-pointer transition-colors";
        
        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = col.selected;
        checkbox.disabled = col.locked; // Logic update: use 'locked' property
        checkbox.className = "w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed";
        
        // Label
        const label = document.createElement('span');
        label.className = "text-xs text-slate-300 font-medium";
        label.innerText = col.label;

        // Toggle Logic
        const toggle = () => {
            if (col.locked) return; // Security check
            col.selected = checkbox.checked;
            console.log(`Updated ${col.id} to ${col.selected}`);
        };

        checkbox.addEventListener('change', toggle);
        
        // Allow clicking the text/row to toggle (better UX)
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox && !col.locked) {
                checkbox.checked = !checkbox.checked;
                toggle();
            }
        });

        item.appendChild(checkbox);
        item.appendChild(label);
        list.appendChild(item);
    });
};

// 3. Auto-Run on Page Load
document.addEventListener('DOMContentLoaded', () => {
    renderColumnSelector(); 
});
/*  IMMEDIATE SECURITY CHECK */
(function() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    console.warn('Unauthorized: no authToken found, redirecting.');
    window.location.href = '/index.html';
  }
})();
/* ====== PAGE INITIALIZATION ====== */
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 NexusGrid Enterprise: Online');

    // 1. Initialize Visuals & Modules
    // (Check if functions exist before calling to prevent crashes)
    if (typeof initAdvancedCharts === 'function') initAdvancedCharts();
    if (typeof initAnalyticsCharts === 'function') initAnalyticsCharts();
    if (typeof generateHeatmap === 'function') generateHeatmap();
    if (typeof toggleAlarmView === 'function') toggleAlarmView('dashboard');
    
    // 2. Initialize UI Helpers
    if (typeof renderColumnSelector === 'function') renderColumnSelector();

    // 3. Start Smart Meter Selector (SAFE CALL)
    // We check if the function exists in the global window object first
    if (typeof window.initMeterSelector === 'function') {
        window.initMeterSelector(); 
    } else {
        console.error("❌ initMeterSelector not found. Make sure api.js is loaded BEFORE app.js in your HTML.");
    }

    startLiveStream();
    if (window.ACTIVE_METER_ID) {
        if (typeof syncSafetyUI === 'function') syncSafetyUI();
      
        
        if (typeof syncDeepAnalytics === 'function') {
            setTimeout(syncDeepAnalytics, 1000); 
        }
    }

    // 6. Load System Settings (Independent of Meter ID)
    if (typeof loadReschedulerSettings === 'function') {
        loadReschedulerSettings('profile'); 
    }
    
    // 7. Start Logic Loop
    if (typeof fetchLatestAndEvaluate === 'function') {
        fetchLatestAndEvaluate();
        setInterval(fetchLatestAndEvaluate, 3000);
    }
});

/*  NAVIGATION & UI HELPERS  */
/**
 * Show tab content (navigation handler)
 */
window.showTab = function(event, tabId) {
  try {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    // Show target tab
    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
      
      // Handle tab-specific initialization
      if (tabId === 'analytics') {
        setTimeout(() => {
          if (mainAnalyticsChart) mainAnalyticsChart.resize();
          if (correlationChartInstance) correlationChartInstance.resize();
          if (loadDensityChart) loadDensityChart.resize();
          window.dispatchEvent(new Event('resize'));
        }, 150);
      }
      
      if (tabId === 'Reports') {
        if (typeof renderColumnSelector === 'function') renderColumnSelector();
      }
      
      if (tabId === 'alarms') {
        if (typeof syncSafetyUI === 'function') syncSafetyUI();
      }
      
      if (tabId === 'profile') {
        if (typeof loadSystemSettings === 'function') loadSystemSettings();
      }
    }
    
    // Mark clicked button as active
    if (event && event.currentTarget) {
      event.currentTarget.classList.add('active');
    }
  } catch (e) {
    console.error('showTab error', e);
  }
};
/* ============================================================
   REPORTING ENGINE (The Missing Link)
   ============================================================ */

// 1. Initialize the Global Data Container
// Your existing generatePDF function looks for this variable.
window.fullAuditData = []; 
let currentPage = 1;
const ROWS_PER_PAGE = 15;

// 2. The "Generate" Button Logic
window.fetchRangeAudit = async function() {
    const startDate = document.getElementById('start-date')?.value;
    const endDate = document.getElementById('end-date')?.value;
    const shift = document.getElementById('shift-filter')?.value;
    const deviceId = window.ACTIVE_METER_ID;

    if (!startDate || !endDate) {
        alert("⚠️ Please select both Start Date and End Date.");
        return;
    }

    const btn = document.querySelector('button[onclick="fetchRangeAudit()"]');
    if(btn) { btn.innerText = "⏳ Loading..."; btn.disabled = true; }

    try {
        const token = localStorage.getItem('authToken');
        // Calls the backend history route
        const url = `${window.API_URL}/history?deviceId=${deviceId}&start=${startDate}&end=${endDate}`;
        
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to fetch audit logs");

        let data = await res.json();

        // Optional Client-Side Shift Filter
        if (shift && shift !== 'all') {
            data = data.filter(d => {
                const h = new Date(d.timestamp).getHours();
                if (shift === 'A') return h >= 6 && h < 14;
                if (shift === 'B') return h >= 14 && h < 22;
                if (shift === 'C') return h >= 22 || h < 6;
                return true;
            });
        }

        // ✅ CRITICAL: Fill the variable your PDF/CSV functions use
        window.fullAuditData = data; 
        
        // Update the 4 Colored Cards
        calculateReportMetrics(data);

        // Render the Table (Page 1)
        currentPage = 1;
        renderAuditTable();

    } catch (err) {
        console.error("Audit Error:", err);
        alert("Failed to load report data. Please check connection.");
    } finally {
        if(btn) { btn.innerText = "Generate"; btn.disabled = false; }
    }
};
// 2. Calculate Summary Metrics (Fixed for Negative Values)
function calculateReportMetrics(data) {
    if (!data || data.length === 0) {
        document.getElementById('report-peak-md').innerText = "---.- kVA";
        document.getElementById('report-avg-pf').innerText = "-.---";
        document.getElementById('report-total-kwh').innerText = "--- kWh";
        document.getElementById('total-count').innerText = "0";
        return;
    }

    // A. Peak Demand (Max Apparent Power)
    const maxKva = Math.max(...data.map(d => parseFloat(d.apparent_power || 0)));
    document.getElementById('report-peak-md').innerHTML = `${maxKva.toFixed(1)} <span class="text-sm text-blue-400">kVA</span>`;

    // B. Average Efficiency (Power Factor)
    const totalPf = data.reduce((sum, d) => sum + parseFloat(d.power_factor || 0), 0);
    const avgPf = (totalPf / data.length).toFixed(3);
    document.getElementById('report-avg-pf').innerText = avgPf;

    // C. Energy Consumed (Robust Logic)
    let totalEnergy = 0;
    
    // 1. Get all Energy Counter values that are not zero
    const kwhValues = data.map(d => parseFloat(d.energy_kwh || 0)).filter(v => v > 0);
    
    if (kwhValues.length > 1) {
        // Method 1: Counter Difference (Max - Min)
        // This works regardless of sort order
        totalEnergy = Math.max(...kwhValues) - Math.min(...kwhValues);
    } else {
        // Method 2: Estimate (Avg Power * Time Duration)
        const avgKw = data.reduce((sum, d) => sum + parseFloat(d.active_power || 0), 0) / data.length;
        
        // Get timestamps
        const times = data.map(d => new Date(d.timestamp).getTime());
        const startTime = Math.min(...times); // Earliest time
        const endTime = Math.max(...times);   // Latest time
        
        // Calculate hours (absolute difference)
        const hours = (endTime - startTime) / 3600000; 
        
        totalEnergy = avgKw * hours;
    }
    
    // Final Safety: Absolute value to prevent negatives
    totalEnergy = Math.abs(totalEnergy);
    
    document.getElementById('report-total-kwh').innerHTML = `${totalEnergy.toFixed(1)} <span class="text-sm text-violet-400">kWh</span>`;

    // D. Samples Count
    document.getElementById('total-count').innerText = data.length.toLocaleString();
}

// 4. Helper: Render Table Rows (Pagination Logic)
window.renderAuditTable = function() {
    const tbody = document.getElementById('audit-table-body');
    const headerRow = document.getElementById('audit-table-header');
    
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!window.fullAuditData || window.fullAuditData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500 italic">No records found for this period.</td></tr>`;
        return;
    }

    // Dynamic Headers based on global ALL_COLUMNS (from app.js) or defaults
    const activeCols = (typeof ALL_COLUMNS !== 'undefined') 
        ? ALL_COLUMNS.filter(c => c.selected) 
        : [ {id: 'timestamp', label: 'Time'}, {id: 'voltage_r', label: 'Voltage'}, {id: 'active_power', label: 'Power'} ];

    if(headerRow) headerRow.innerHTML = activeCols.map(c => `<th class="p-4">${c.label}</th>`).join('');

    // Pagination Slicing
    const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
    const endIdx = startIdx + ROWS_PER_PAGE;
    const pageData = window.fullAuditData.slice(startIdx, endIdx);

    // Render Rows
    pageData.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/30 transition-colors border-b border-slate-800/50";
        tr.innerHTML = activeCols.map(col => {
            let val = row[col.id];
            if (col.id === 'timestamp') val = new Date(val).toLocaleString();
            else if (typeof val === 'number') val = val.toFixed(2);
            return `<td class="p-4 text-slate-300">${val || '-'}</td>`;
        }).join('');
        tbody.appendChild(tr);
    });

    // Update Pagination Footer UI
    const rangeEl = document.getElementById('current-range');
    if(rangeEl) rangeEl.innerText = `${startIdx + 1} - ${Math.min(endIdx, window.fullAuditData.length)}`;
    
    const pageEl = document.getElementById('page-indicator');
    if(pageEl) pageEl.innerText = `PAGE ${currentPage}`;
};

// 5. Pagination Buttons
window.changePage = function(direction) {
    const maxPage = Math.ceil(window.fullAuditData.length / ROWS_PER_PAGE);
    if (currentPage + direction > 0 && currentPage + direction <= maxPage) {
        currentPage += direction;
        renderAuditTable();
    }
};

// 6. CSV Export (Just in case you need it, checks if data exists first)
window.exportToCSV = function() {
    if (!window.fullAuditData || window.fullAuditData.length === 0) {
        alert("⚠️ No data loaded. Please click 'Generate' first.");
        return;
    }
    // ... Uses activeCols to generate CSV ...
    const activeCols = (typeof ALL_COLUMNS !== 'undefined') ? ALL_COLUMNS.filter(c => c.selected) : [];
    const headers = activeCols.map(c => c.label).join(',');
    const rows = window.fullAuditData.map(row => 
        activeCols.map(col => row[col.id]).join(',')
    ).join('\n');

    const link = document.createElement("a");
    link.href = "data:text/csv;charset=utf-8," + encodeURI(headers + "\n" + rows);
    link.download = `NexusGrid_Audit_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
/**
 * Logout function
 */
window.logout = function() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  window.location.href = '/index.html';
};
/* 
   REPORTING & EXPORT FUNCTIONS
 */

// 1. Define Default Columns (Safeguard if ALL_COLUMNS is missing)
const DEFAULT_COLS = [
    { id: 'timestamp', label: 'Time', selected: true },
    { id: 'voltage_r', label: 'Voltage R (V)', selected: true },
    { id: 'current_r', label: 'Current R (A)', selected: true },
    { id: 'active_power', label: 'Power (kW)', selected: true },
    { id: 'power_factor', label: 'PF', selected: true }
];
/* 
   UI INTERACTION FUNCTIONS
    */

window.toggleColumnDropdown = function(event) {
    if (event) event.stopPropagation(); // Stop the click from closing it immediately
    
    // NOTE: We use the correct ID 'column-select-dropdown' found in your HTML
    const dropdown = document.getElementById('column-select-dropdown');
    
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    } else {
        console.error("❌ Error: Element with id='column-select-dropdown' not found.");
    }
};

// Close dropdown when clicking anywhere else on the page
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('column-select-dropdown');
    const button = event.target.closest('button[onclick*="toggleColumnDropdown"]');
    
    // If click is OUTSIDE the dropdown AND OUTSIDE the toggle button, close it
    if (dropdown && !dropdown.classList.contains('hidden') && !dropdown.contains(event.target) && !button) {
        dropdown.classList.add('hidden');
    }
});

// 3. GENERATE PDF FUNCTION (Your Code + Global Fix)
window.generatePDF = async function() {
    console.log("📄 PDF Generation Started...");
    
    // Validation
    if (!fullAuditData || fullAuditData.length === 0) {
        alert("⚠️ Please click 'GENERATE' to load data before downloading.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const isSummaryOnly = document.getElementById('pdf-summary-only')?.checked;
    
    // Plugin Registration Check
    if (typeof jsPDF.API.autoTable !== 'function') {
        const plugin = window.jspdfAutotable || window.autoTable;
        if (plugin) {
            if (typeof plugin.default === 'function') plugin.default(jsPDF);
            else if (typeof plugin === 'function') plugin(jsPDF);
        } else {
            alert("❌ PDF Table Plugin missing. Check script tags in HTML.");
            return;
        }
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    const primaryColor = [15, 23, 42]; 

    try {
        // --- PAGE 1: HEADER & MAIN DATA ---
        const drawHeader = (title) => {
            doc.setFillColor(...primaryColor);
            doc.rect(0, 0, 297, 35, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(22);
            doc.setFont("helvetica", "bold");
            doc.text(title, 15, 18);
            
            const peak = document.getElementById('report-peak-md')?.innerText || "0.0 kVA";
            const pf = document.getElementById('report-avg-pf')?.innerText || "0.000";
            const energy = document.getElementById('report-total-kwh')?.innerText || "0.0 kWh";
            
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text(`Executive Summary | Peak: ${peak} | Avg PF: ${pf} | Total Energy: ${energy}`, 15, 28);
        };

        drawHeader(isSummaryOnly ? "NEXUSGRID EXECUTIVE SUMMARY" : "NEXUSGRID FULL AUDIT REPORT");

        // Determine Columns (Safe Fallback)
        const activeCols = (typeof ALL_COLUMNS !== 'undefined') ? ALL_COLUMNS.filter(c => c.selected) : DEFAULT_COLS;

        if (!isSummaryOnly) {
            // Prepare Row Data
            const tableHeaders = [activeCols.map(col => col.label.toUpperCase())];
            const tableRows = fullAuditData.map(row => {
                return activeCols.map(col => {
                    let val = row[col.id];
                    if (col.id === 'timestamp') return new Date(val).toLocaleString();
                    if (typeof val === 'number') return val.toFixed(col.id.includes('factor') ? 3 : 2);
                    return val || '0.00';
                });
            });

            // Main Data Table
            doc.autoTable({
                head: tableHeaders,
                body: tableRows,
                startY: 42,
                theme: 'striped',
                headStyles: { fillColor: primaryColor, fontSize: 8, fontStyle: 'bold', halign: 'center' },
                bodyStyles: { fontSize: 7, textColor: [30, 41, 59], halign: 'center' },
                margin: { left: 15, right: 15 },
                didParseCell: function(data) {
                    if (data.section === 'body') {
                        const headerObj = data.column.raw || "";
                        const headerText = String(headerObj).toLowerCase();
                        if (headerText.includes('pf') || headerText.includes('factor')) {
                            const pfValue = parseFloat(data.cell.text);
                            if (!isNaN(pfValue) && pfValue < 0.85) {
                                data.cell.styles.textColor = [220, 38, 38];
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                }
            });
            doc.addPage();
            drawHeader("ANALYTICAL STATISTICS SUMMARY");
        }

        // --- SUMMARY STATISTICS PAGE ---
        const statsHeaders = [["PARAMETER", "MINIMUM", "MAXIMUM", "AVERAGE", "UNIT"]];
        const statsRows = activeCols.filter(c => c.id !== 'timestamp').map(col => {
            const values = fullAuditData.map(d => parseFloat(d[col.id])).filter(v => !isNaN(v));
            if (values.length === 0) return [col.label, "-", "-", "-", "-"];
            
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            
            let unit = "-";
            if(col.id.includes('voltage')) unit = "V";
            else if(col.id.includes('current')) unit = "A";
            else if(col.id.includes('power')) unit = "kW";
            else if(col.id.includes('factor')) unit = "cosφ";

            return [col.label, min.toFixed(2), max.toFixed(2), avg.toFixed(2), unit];
        });

        doc.autoTable({
            head: statsHeaders,
            body: statsRows,
            startY: 45,
            theme: 'grid',
            headStyles: { fillColor: [51, 65, 85], halign: 'center' },
            styles: { fontSize: 8, halign: 'center', cellPadding: 4 },
            columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 60 } }
        });

        // Footer & Signature
        const finalY = doc.lastAutoTable.finalY + 30;
        if (finalY < 180) {
            doc.setDrawColor(200, 200, 200);
            doc.line(15, finalY, 80, finalY);
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text("AUTHORIZED SITE ENGINEER SIGNATURE", 15, finalY + 5);
        }

        doc.save(`NexusGrid_${isSummaryOnly ? 'Summary' : 'FullAudit'}_${Date.now()}.pdf`);
        console.log(" PDF Process Complete");

    } catch (error) {
        console.error("Detailed PDF Error:", error);
        alert("An error occurred during PDF generation. Check console.");
    }
};

window.switchMeter = function(newId) {
    // 1. Validation: Don't switch if it's the same ID or invalid
    if (!newId || newId === window.ACTIVE_METER_ID) return;

    console.group(`🔌 System Switch Event`);
    console.log(`Transitioning: ${window.ACTIVE_METER_ID} ➔ ${newId}`);

    // 2. Commit Global State
    window.ACTIVE_METER_ID = newId;
    localStorage.setItem('lastMeterId', newId);

    // 3. UI Update: Change Header Dropdown Text (If element exists)
    const headerLabel = document.getElementById('meter-dropdown-btn'); // Or 'selected-meter-label'
    if (headerLabel) {
        // Keep the icon, just change text
        headerLabel.innerHTML = `<i class="fas fa-tachometer-alt mr-2"></i> ${newId} <i class="fas fa-chevron-down ml-auto"></i>`;
    }

    // 4. CHART RESET: Clear Main Analytics Chart (Line Chart)
    // Prevents "connecting the dots" between two different devices
    if (window.mainAnalyticsChart) {
        window.mainAnalyticsChart.data.labels = [];
        window.mainAnalyticsChart.data.datasets.forEach(dataset => dataset.data = []);
        window.mainAnalyticsChart.update('none'); // 'none' mode prevents visual animation glitches
    }

    // 5. CHART RESET: Clear Correlation Chart (Scatter)
    if (window.correlationChartInstance) {
        window.correlationChartInstance.data.datasets.forEach(dataset => dataset.data = []);
        window.correlationChartInstance.update();
    }

    // 6. VISUAL RESET: Clear Heatmap Grid
    // Sets all cells to 'Offline/Gray' state immediately
    const grid = document.getElementById('heatmap-grid');
    if (grid) {
        Array.from(grid.children).forEach(cell => {
            cell.className = 'w-full h-4 rounded-sm bg-slate-800 border border-transparent transition-colors duration-200';
            cell.title = "Loading data...";
        });
    }

    // 7. DATA SYNCHRONIZATION (The "Brain" Reload)
    // Checks if API functions are loaded before calling them to prevent crashes


    // B. Sync Historical Data (Heatmap & Load Density)
    if (typeof window.syncDeepAnalytics === 'function') {
        window.syncDeepAnalytics().catch(err => console.warn("Analytics sync failed:", err));
    }

    // C. Sync Safety Thresholds (Over-voltage limits, etc.)
    if (typeof window.syncSafetyUI === 'function') {
        window.syncSafetyUI().catch(err => console.warn("Safety sync failed:", err));
    }

    console.log(`✅ Switched to ${newId}. Waiting for live stream...`);
    console.groupEnd();

};

