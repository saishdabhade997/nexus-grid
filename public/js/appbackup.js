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

function updateManual(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = value;
  el.classList.remove('skeleton');
  el.style.color = '#60a5fa';
  setTimeout(() => { el.style.color = ''; }, 300);
}

/* ====== SWITCH METER ====== */
function switchMeter(newId) {
    if (newId === ACTIVE_METER_ID) return;
    
    console.log(`🔌 Switching Context to: ${newId}`);
    ACTIVE_METER_ID = newId;
    localStorage.setItem('lastMeterId', newId);

    // Visual Feedback
    document.getElementById('overview').classList.add('opacity-50');

    // Clear Old Data
    activeThreats.clear(); 
    if(mainAnalyticsChart) {
        mainAnalyticsChart.data.labels = [];
        mainAnalyticsChart.data.datasets.forEach(d => d.data = []);
        mainAnalyticsChart.update();
    }

    // Trigger All Updates
    setTimeout(() => {
        document.getElementById('overview').classList.remove('opacity-50');

        // Refresh Safety & Alarms
        syncSafetyUI();
        const activeList = document.getElementById('active-list');
        if(activeList) activeList.innerHTML = '<div class="text-center py-10 text-gray-500 text-xs italic">Scanning new stream...</div>';

        // Refresh Analytics (Charts)
        const currentRange = isLiveMode ? 'live' : '24h';
        updateTimeRange(currentRange);

        // Refresh Deep Analytics (Heatmap)
        syncDeepAnalytics();

        // Refresh Financial Cards
        syncFinancialCards();
        
        // Refresh Tariff Settings
        syncTariffUI();

    }, 500);
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

/* ====== FIXED FETCH AUDIT FUNCTION  app.js) ====== */
window.fetchRangeAudit = async function() {
    // 1. Setup UI
    const dropdown = document.getElementById('column-select-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const startEl = document.getElementById('start-date'); 
    const endEl = document.getElementById('end-date');
    const shiftEl = document.getElementById('shift-filter');
    const spinner = document.getElementById('loading-spinner');
    const tbody = document.getElementById('audit-table-body');

    // 2. Validation
    if (!startEl || !endEl) {
        console.error(" Critical Error: Date inputs missing.");
        return;
    }
    if (!startEl.value || !endEl.value) {
        alert(" Please select both Start Date and End Date.");
        return;
    }

    // 3. Show Loading State
    if (spinner) spinner.classList.remove('hidden');
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-blue-400 animate-pulse">Fetching records from server...</td></tr>';

    try {
        const deviceId = window.ACTIVE_METER_ID || 'meter_01';
        const token = localStorage.getItem('authToken');
        
        // 4. Fetch Data
        const url = `/api/history?start=${startEl.value}&end=${endEl.value}&deviceId=${deviceId}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(`Server Error: ${response.status}`);

        const rawData = await response.json();

        // 5. Handle Empty Data
        if (!Array.isArray(rawData) || rawData.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-gray-500">No records found for this range.</td></tr>';
            window.fullAuditData = []; // Clear global data
            return;
        }

        // 6. Filter by Shift (Client Side)
        const shift = shiftEl ? shiftEl.value : 'all';
        const filteredData = rawData.filter(row => {
            if (shift === 'all') return true;
            const hour = new Date(row.timestamp).getHours();
            if (shift === 'A') return hour >= 6 && hour < 14;
            if (shift === 'B') return hour >= 14 && hour < 22;
            if (shift === 'C') return hour >= 22 || hour < 6;
            return true;
        });

        // 7. CRITICAL FIX: Save to Global Window Object
        window.fullAuditData = filteredData; 
        console.log(`✅ Data Loaded: ${filteredData.length} records ready for export.`);

        // 8. Render Table
        if (typeof renderAuditTable === 'function') {
            renderAuditTable(filteredData);
        } else {
            // Fallback render if function missing
            if (tbody) {
                tbody.innerHTML = '';
                filteredData.slice(0, 100).forEach(row => {
                    const tr = document.createElement('tr');
                    tr.className = "border-b border-slate-800 hover:bg-slate-800/50";
                    tr.innerHTML = `<td class="p-3 text-slate-300">${new Date(row.timestamp).toLocaleString()}</td>
                                    <td class="p-3 text-blue-400">${Number(row.active_power).toFixed(2)} kW</td>
                                    <td class="p-3 text-emerald-400">${Number(row.current_r).toFixed(2)} A</td>`;
                    tbody.appendChild(tr);
                });
            }
        }

        // 9. Update Stats Cards (Optional)
        if (document.getElementById('total-count')) {
            document.getElementById('total-count').innerText = filteredData.length;
        }

    } catch (err) {
        console.error("Fetch Error:", err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-red-500">Error: ${err.message}</td></tr>`;
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
};
 
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

            // Billing engine
            try {
                updateBillingEngine(safeData);
            } catch (billErr) {
                console.error(' Billing engine error:', billErr);
            }
        });

socket.on('billing-update', (payload) => {
    if (billingUpdateTimeout) clearTimeout(billingUpdateTimeout);
    
    billingUpdateTimeout = setTimeout(() => {
        try {
            // --- 1. GREEN CARD: Est. Accrued Bill ---
            const costEl = document.getElementById('cost-energy');
            if (costEl) {
                const totalBill = Number(payload.total_bill || 0);
                costEl.innerText = `₹ ${totalBill.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                
                // Cycle Projection (Small green text)
                const projectEl = document.querySelector('#financials .text-emerald-500'); // Matches class in HTML
                if (projectEl && totalBill > 0) {
                    const daysElapsed = Math.max(1, new Date().getDate());
                    const projected = (totalBill / daysElapsed) * 30;
                    projectEl.innerText = `Cycle Projection: ₹ ${projected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                }
            }

            // --- 2. RED CARD: Efficiency Penalties ---
            const penaltyEl = document.getElementById('cost-penalty');
            if (penaltyEl) {
                const penalty = Number(payload.penalty_total || 0);
                
                // Logic: Negative penalty = Rebate (Green), Positive = Fine (Red)
                if (penalty < 0) {
                    penaltyEl.innerText = `- ₹ ${Math.abs(penalty).toFixed(2)}`;
                    penaltyEl.classList.remove('text-white', 'text-red-500');
                    penaltyEl.classList.add('text-emerald-400');
                } else {
                    penaltyEl.innerText = `₹ ${penalty.toFixed(2)}`;
                    penaltyEl.classList.remove('text-emerald-400');
                    
                    if (penalty > 100) {
                        penaltyEl.classList.add('text-red-500');
                        penaltyEl.classList.remove('text-white');
                        // Add glow effect to card
                        const card = penaltyEl.closest('.glass-card');
                        if (card) {
                            card.style.boxShadow = "0 0 20px rgba(239,68,68,0.4)";
                            card.style.borderColor = "rgba(239,68,68,0.5)";
                        }
                    } else {
                        penaltyEl.classList.add('text-white');
                        penaltyEl.classList.remove('text-red-500');
                        // Remove glow
                        const card = penaltyEl.closest('.glass-card');
                        if(card) { card.style.boxShadow = ""; card.style.borderColor = ""; }
                    }
                }
            }

            // --- 3. BLUE CARD: Fixed Demand Charges ---
            const peakEl = document.getElementById('cost-md');
            const peakText = document.getElementById('md-peak-text');
            
            if (peakEl) {
                const fixedCost = Number(payload.fixed_cost || 0);
                peakEl.innerText = `₹ ${fixedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                
                if (peakText && payload.peak_demand != null) {
                    const peakDemand = Number(payload.peak_demand);
                    peakText.innerText = `MD Peak: ${peakDemand.toFixed(1)} kVA`;
                    
                    // Check against allotted load
                    const allottedLoad = parseFloat(document.getElementById('allotted-load')?.value) || 500;
                    const utilizationPercent = (peakDemand / allottedLoad) * 100;
                    
                    if (utilizationPercent > 90) {
                        peakText.className = "text-[10px] text-red-500 mt-3 font-bold uppercase animate-pulse";
                    } else if (utilizationPercent > 75) {
                        peakText.className = "text-[10px] text-yellow-500 mt-3 font-bold uppercase";
                    } else {
                        peakText.className = "text-[10px] text-blue-400 mt-3 font-bold uppercase";
                    }
                }
            }

            // --- 4. PURPLE CARD: Blended Unit Rate ---
            const rateEl = document.getElementById('avg-unit-rate');
            if (rateEl) {
                const blendedRate = Number(payload.blended_rate || 0);
                const currentRate = Number(payload.current_rate || 0);
                const finalRate = (blendedRate > 0) ? blendedRate : currentRate;
                
                rateEl.innerText = `₹ ${finalRate.toFixed(2)}`;
            }

            // --- 5. TEAL CARD: Cost Efficiency (Calculated Insight) ---
            const costPerUnitEl = document.getElementById('cost-per-unit');
            const efficiencyBar = document.getElementById('efficiency-bar');
            const efficiencyBadge = document.getElementById('efficiency-badge');
            const efficiencyPct = document.getElementById('efficiency-percent');

            if (costPerUnitEl) {
                const rate = parseFloat(payload.blended_rate || 0);
                const baseRate = parseFloat(payload.current_rate || 7.5);

                costPerUnitEl.innerText = `₹ ${rate.toFixed(2)}`;

                if (baseRate > 0) {
                    // Calc efficiency (Higher rate = Lower efficiency)
                    let eff = 100 - ((rate - baseRate) / baseRate * 100);
                    eff = Math.min(100, Math.max(0, eff)); // Clamp 0-100

                    if (efficiencyBar) efficiencyBar.style.width = `${eff.toFixed(0)}%`;
                    if (efficiencyPct) efficiencyPct.innerText = `${eff.toFixed(0)}%`;

                    if (efficiencyBadge) {
                        if (eff > 90) {
                            efficiencyBadge.innerText = "OPTIMAL";
                            efficiencyBadge.className = "px-2 py-1 bg-teal-500/20 text-teal-400 text-[8px] font-black rounded uppercase";
                        } else if (eff > 70) {
                            efficiencyBadge.innerText = "MODERATE";
                            efficiencyBadge.className = "px-2 py-1 bg-yellow-500/20 text-yellow-400 text-[8px] font-black rounded uppercase";
                        } else {
                            efficiencyBadge.innerText = "POOR";
                            efficiencyBadge.className = "px-2 py-1 bg-red-500/20 text-red-400 text-[8px] font-black rounded uppercase";
                        }
                    }
                }
            }

            // --- 6. AMBER CARD: Peak Hour Impact (Estimated) ---
            // Note: Your server currently doesn't send specific Shift B cost, so we estimate based on active shift or averages.
            const peakHourCostEl = document.getElementById('peak-hour-cost');
            const peakImpactBar = document.getElementById('peak-impact-bar');
            const shiftBPctEl = document.getElementById('shift-b-percent');

            if (peakHourCostEl) {
                // Estimation: Assume 35% of bill is Peak Hour (Shift B)
                // In a future update, you should calculate this exactly in the backend
                const totalBill = parseFloat(payload.total_bill || 0);
                const estimatedPeakCost = totalBill * 0.35; 
                
                peakHourCostEl.innerText = `₹ ${estimatedPeakCost.toFixed(0)}`;
                
                if(peakImpactBar) peakImpactBar.style.width = "35%"; // Static for now
                if(shiftBPctEl) shiftBPctEl.innerText = "35%";
            }

            // --- 7. PINK CARD: Savings Opportunity ---
            const savingsEl = document.getElementById('savings-potential');
            if (savingsEl) {
                const penalties = parseFloat(payload.penalty_total || 0);
                // Assume we can save 100% of penalties + 5% of energy bill via optimization
                const totalBill = parseFloat(payload.total_bill || 0);
                const potentialSavings = Math.max(0, penalties + (totalBill * 0.05));
                
                savingsEl.innerText = `₹ ${potentialSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            }

        } catch (e) {
            console.error('❌ Billing UI Error:', e);
        }
    }, 100);
});
  } catch (err) {
    console.error('startLiveStream error', err);
  }
}

// 1. Define Available Columns (Your Complete List)
const ALL_COLUMNS = [
    // 1. Time (Locked)
    { id: 'timestamp', label: 'Timestamp', locked: true, selected: true },

    // 2. Voltages (Phase & THD)
    { id: 'voltage_r', label: 'Voltage R (V)', selected: true },
    { id: 'voltage_y', label: 'Voltage Y (V)', selected: false },
    { id: 'voltage_b', label: 'Voltage B (V)', selected: false },
    { id: 'v_thd_r', label: 'V-THD R (%)', selected: false },
    { id: 'v_thd_y', label: 'V-THD Y (%)', selected: false },
    { id: 'v_thd_b', label: 'V-THD B (%)', selected: false },

    // 3. Currents (Phase, Neutral & THD)
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
/* 
   BILLING PDF GENERATOR
    */

window.generateBillingPDF = function() {
    console.log("📄 Generating Billing Statement...");

    // 1. Get Values from UI (What the user sees)
    const energyCostText = document.getElementById('cost-energy')?.innerText || "₹ 0.00";
    const demandCostText = document.getElementById('cost-md')?.innerText || "₹ 0.00";
    const penaltyCostText = document.getElementById('cost-penalty')?.innerText || "₹ 0.00";
    const unitRateText = document.getElementById('avg-unit-rate')?.innerText || "₹ 0.00";
    
    // Get Dates
    const startStr = document.getElementById('billing-start-date')?.value || "N/A";
    const endStr = document.getElementById('billing-end-date')?.value || "N/A";

    // 2. Parse Numeric Values for Total Calculation
    const clean = (str) => parseFloat(str.replace(/[^\d.-]/g, '')) || 0;
    const energyVal = clean(energyCostText);
    const demandVal = clean(demandCostText);
    const penaltyVal = clean(penaltyCostText);
    const totalVal = energyVal + demandVal + penaltyVal;

    // 3. Initialize PDF
    if (!window.jspdf) {
        alert("PDF Library not loaded. Please refresh.");
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    // Colors
    const colorPrimary = [15, 23, 42]; // Dark Slate
    const colorAccent = [59, 130, 246]; // Blue

    // --- HEADER ---
    doc.setFillColor(...colorPrimary);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("ELECTRICITY BILL STATEMENT", 15, 20);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Period: ${startStr} to ${endStr}`, 15, 30);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, 35);

    // --- SUMMARY BOX ---
    let yPos = 55;
    
    // Helper for rows
    const drawRow = (label, value, isBold = false) => {
        doc.setFont("helvetica", isBold ? "bold" : "normal");
        doc.setTextColor(0, 0, 0);
        doc.text(label, 20, yPos);
        doc.text(value, 190, yPos, { align: "right" });
        yPos += 10;
        doc.setDrawColor(220, 220, 220);
        doc.line(20, yPos - 6, 190, yPos - 6);
    };

    doc.setFontSize(12);
    doc.setTextColor(59, 130, 246);
    doc.text("Cost Breakdown", 15, yPos - 5);
    yPos += 5;

    drawRow("Energy Charges (Active Consumption)", energyCostText);
    drawRow("Fixed Demand Charges (Contract/MD)", demandCostText);
    
    // Penalty in Red if high
    doc.setTextColor(penaltyVal > 0 ? 220 : 0, 0, 0); 
    drawRow("Efficiency & PF Penalties", penaltyCostText);
    
    yPos += 5;
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("NET PAYABLE AMOUNT", 20, yPos);
    doc.setTextColor(59, 130, 246);
    doc.text(`Rs. ${totalVal.toLocaleString(undefined, {minimumFractionDigits: 2})}`, 190, yPos, { align: "right" });

    // --- STATISTICS SECTION ---
    yPos += 20;
    doc.setFillColor(245, 247, 250);
    doc.rect(15, yPos, 180, 40, 'F');
    
    yPos += 10;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Operational Insights:", 20, yPos);
    
    yPos += 10;
    doc.setTextColor(0, 0, 0);
    doc.text(`• Effective Unit Rate: ${unitRateText} / kWh`, 25, yPos);
    yPos += 7;
    
    // Add logic here if you want to pull peak demand from the UI text
    const peakText = document.getElementById('md-peak-text')?.innerText || "";
    if(peakText) {
        doc.text(`• ${peakText}`, 25, yPos);
    }

    // Footer
    const finalY = 280;
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("This is a system-generated estimate based on real-time telemetry.", 105, finalY, { align: "center" });
    doc.text("NexusGrid Enterprise Platform", 105, finalY + 5, { align: "center" });

    // 4. Save File
    doc.save(`NexusGrid_Bill_${startStr}_${endStr}.pdf`);
};
/* ============================================================
   HELPER: TIME FORMATTER (Fixes the "10:00:00:00" error)
   ============================================================ */
function formatTime(timeStr) {
    if (!timeStr) return "00:00";
    // Takes "10:00:00:00" or "10:00:00" and forces "10:00"
    return String(timeStr).substring(0, 5); 
}
/* ============================================================
   RESCHEDULER SETTINGS (Fixes ReferenceError)
   ============================================================ */
window.saveReschedulerSettings = async function(type) {
    const btn = document.getElementById(`save-rescheduler-${type}-btn`);
    const originalText = btn.innerText;
    
    // 1. Get Values
    const email = document.getElementById(`rescheduler-email-${type}`)?.value;
    const enabled = document.getElementById(`rescheduler-email-enabled-${type}`)?.checked;
    const date = document.getElementById(`rescheduler-date-${type}`)?.value;
    const time = document.getElementById(`rescheduler-time-${type}`)?.value;
    const freq = document.getElementById(`rescheduler-frequency-${type}`)?.value;
    const statusEl = document.getElementById(`rescheduler-status-${type}`);

    // 2. Validate
    if (!email || !date || !time) {
        alert("Please fill in all schedule fields.");
        return;
    }

    // 3. Set Loading State
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/rescheduler', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                section: type, // 'billing' or 'profile'
                emailEnabled: enabled,
                email: email,
                date: date,
                time: time,
                frequency: freq
            })
        });

        const result = await response.json();

        if (response.ok) {
            if (statusEl) {
                statusEl.classList.remove('hidden');
                statusEl.innerHTML = `<span class="text-green-400 font-bold">✅ Saved!</span> Next run: ${date} @ ${time}`;
            }
        } else {
            throw new Error(result.error || "Failed to save");
        }

    } catch (err) {
        console.error(err);
        alert("Error saving schedule: " + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

// Helper to load settings on page load
window.loadReschedulerSettings = async function(type) {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/rescheduler?section=${type}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (response.ok) {
            if(document.getElementById(`rescheduler-email-${type}`)) 
                document.getElementById(`rescheduler-email-${type}`).value = data.email;
            if(document.getElementById(`rescheduler-email-enabled-${type}`)) 
                document.getElementById(`rescheduler-email-enabled-${type}`).checked = data.emailEnabled;
            if(document.getElementById(`rescheduler-date-${type}`)) 
                document.getElementById(`rescheduler-date-${type}`).value = data.date;
            if(document.getElementById(`rescheduler-time-${type}`)) 
                document.getElementById(`rescheduler-time-${type}`).value = data.time;
            if(document.getElementById(`rescheduler-frequency-${type}`)) 
                document.getElementById(`rescheduler-frequency-${type}`).value = data.frequency;
        }
    } catch (err) {
        console.warn(`Failed to load ${type} schedule`, err);
    }
};
/*
   TARIFF UI SYNC
 */
window.syncTariffUI = async function() {
    console.log(`💰 Loading Tariff for ${ACTIVE_METER_ID}`);
    
    try {
        const token = localStorage.getItem('authToken');
        // Fetch config from backend
        const response = await fetch(`${API_URL}/devices/${ACTIVE_METER_ID}/settings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Failed to load settings");

        const data = await response.json();
        
        // Update Global Config if needed
        if (data.tariff_config) {
            window.TARIFF_CONFIG = data.tariff_config;
        }

        // --- APPLY VALUES TO INPUTS WITH FIX ---
        const shifts = data.tariff_config?.shifts || {};

        if (shifts.A) {
            if(document.getElementById('shift-a-start')) document.getElementById('shift-a-start').value = formatTime(shifts.A.start);
            if(document.getElementById('shift-a-end')) document.getElementById('shift-a-end').value = formatTime(shifts.A.end);
            if(document.getElementById('shift-a-rate')) document.getElementById('shift-a-rate').value = shifts.A.rate;
        }

        if (shifts.B) {
            if(document.getElementById('shift-b-start')) document.getElementById('shift-b-start').value = formatTime(shifts.B.start);
            if(document.getElementById('shift-b-end')) document.getElementById('shift-b-end').value = formatTime(shifts.B.end);
            if(document.getElementById('shift-b-rate')) document.getElementById('shift-b-rate').value = shifts.B.rate;
        }

        if (shifts.C) {
            if(document.getElementById('shift-c-start')) document.getElementById('shift-c-start').value = formatTime(shifts.C.start);
            if(document.getElementById('shift-c-end')) document.getElementById('shift-c-end').value = formatTime(shifts.C.end);
            if(document.getElementById('shift-c-rate')) document.getElementById('shift-c-rate').value = shifts.C.rate;
        }

        console.log("✅ Tariff UI Synced");

    } catch (err) {
        console.error("Tariff Sync Error:", err);
    }
};

/* ====== PAGE INITIALIZATION ====== */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 NexusGrid Enterprise: Online');
  initAdvancedCharts();
  initMeterSelector();
  initAnalyticsCharts();
  generateHeatmap();
  toggleAlarmView('dashboard');
    

  if (typeof renderColumnSelector === 'function') renderColumnSelector();
  startLiveStream();
  if (typeof updateSubscriptionUI === 'function') updateSubscriptionUI();
  syncSafetyUI();
  syncTariffUI();
  syncFinancialCards();
  if (typeof loadReschedulerSettings === 'function') {
    loadReschedulerSettings('profile'); 
    loadReschedulerSettings('billing');
  }
 if (typeof syncDeepAnalytics === 'function') {
        setTimeout(syncDeepAnalytics, 1000); 
    }
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
      
      if (tabId === 'tariffs') {
        setTimeout(() => {
          if (typeof syncTariffUI === 'function') syncTariffUI();
        }, 100);
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
/* ====== EXPOSE FUNCTIONS TO GLOBAL SCOPE ====== */
/* ============================================================
   DEVICE SWITCHING LOGIC (Mission Critical)
   Handles seamless transition between metering nodes.
   ============================================================ */
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
    
    // A. Sync Pricing & Shifts (Billing)
    if (typeof window.syncTariffUI === 'function') {
        window.syncTariffUI().catch(err => console.warn("Tariff sync failed:", err));
    }

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