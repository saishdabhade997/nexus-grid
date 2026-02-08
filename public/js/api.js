/* ------------------------------------------------------------
   0. UTILITIES
   ------------------------------------------------------------ */
// Helper: Forces ANY time format (Number or String) into HTML-compliant "HH:mm"
function formatTime(input) {
    if (input === null || input === undefined) return "00:00";

    const str = String(input).trim();

    // Scenario A: Input is like "06:00:00" or "6:30"
    if (str.includes(':')) {
        const parts = str.split(':');
        const h = parts[0].padStart(2, '0'); // Ensures "6" becomes "06"
        const m = parts[1].padStart(2, '0');
        return `${h}:${m}`;
    }

    // Scenario B: Input is a number like 6, 14, or "22"
    // This fixes your specific error: "The specified value '6' does not conform..."
    const num = parseFloat(str);
    if (!isNaN(num)) {
        const h = Math.floor(num);
        const m = Math.round((num - h) * 60); // Handles decimals like 6.5 -> 06:30
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    return "00:00";
}
/* ============================================================
   SMART METER SELECTOR (With Manual Switch Logic)
   ============================================================ */
/* ============================================================
   SMART METER SELECTOR (Fully Dynamic & Corrected)
   ============================================================ */
/* ============================================================
   SMART METER SELECTOR (Complete & Syntax-Safe)
   ============================================================ */
async function initMeterSelector() {
    const select = document.getElementById('global-meter-select');
    if (!select) return;

    // 1. SAFETY CHECK: Ensure the URL is valid to prevent "undefined/my-meters"
    const API_ROOT = window.API_URL || window.API_BASE_URL || "https://nexusgrid-api.onrender.com/api";

    try {
        const token = localStorage.getItem('authToken');
        console.log("🔄 Fetching assigned meters from database...");

    // Add this line at the start of the function
const API_ROOT = window.API_URL || "https://nexusgrid-api.onrender.com/api";

// Use API_ROOT in your fetch
const res = await fetch(`${API_ROOT}/my-meters`, {
    headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }
});

        if (res.ok) {
            const meters = await res.json();
            
            // Scenario A: User has NO meters in the database
            if (!meters || meters.length === 0) {
                select.innerHTML = '<option disabled selected>No Meters Assigned</option>';
                window.ACTIVE_METER_ID = null;
                console.warn("⚠️ Database returned 0 meters for this user.");
                return;
            }

            // Scenario B: Render the dropdown dynamically (ONLY shows DB data)
            select.innerHTML = meters.map(m => 
                `<option value="${m.device_id}" ${m.device_id === window.ACTIVE_METER_ID ? 'selected' : ''}>
                    ${m.device_name || m.device_id}
                </option>`
            ).join('');

            // Scenario C: Auto-Correction (Force valid ID)
            const currentIdIsValid = meters.some(m => m.device_id === window.ACTIVE_METER_ID);

            if (!window.ACTIVE_METER_ID || !currentIdIsValid) {
                const defaultMeter = meters[0].device_id;
                console.log(`📡 Setting active meter to database default: ${defaultMeter}`);
                
                select.value = defaultMeter;
                window.ACTIVE_METER_ID = defaultMeter;
                localStorage.setItem('lastMeterId', defaultMeter);
                
                if (typeof window.switchMeter === 'function') {
                    window.switchMeter(defaultMeter);
                }
            }
        } else {
            throw new Error(`Server responded with ${res.status}`);
        }
    } catch (e) {
        console.error("❌ Failed to load meters:", e);
        select.innerHTML = `<option selected disabled>Connection Failed</option>`;
    }

    // --- MANUAL SELECTION HANDLER ---
    // We clone the node to clear any old event listeners
    const newSelect = select.cloneNode(true);
    select.parentNode.replaceChild(newSelect, select);
    
    newSelect.addEventListener('change', (e) => {
        const newId = e.target.value;
        console.log(`🔄 User manually switched to: ${newId}`);
        localStorage.setItem('lastMeterId', newId);
        window.ACTIVE_METER_ID = newId;
        
        if (typeof window.switchMeter === 'function') {
            window.switchMeter(newId);
        }
    });
}

// Attach to window so app.js can see it
window.initMeterSelector = initMeterSelector;
/* ============================================================
   SYSTEM SETTINGS (User Preferences)
   ============================================================ */
window.saveSystemSettings = async function() {
    const btn = document.getElementById('save-sys-btn');
    const originalText = btn ? btn.innerText : 'Save Config';

    // 1. UI Feedback (Sending Request State)
    if (btn) {
        btn.innerHTML = '<i class="fas fa-paper-plane fa-pulse mr-2"></i> SENDING REQ...';
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
        // 2. Gather Data from Inputs
        const alertEmailInput = document.getElementById('alert-email');
        const enableAlertsInput = document.getElementById('enable-alerts');
        const retentionInput = document.getElementById('retention-days');
        const persistInput = document.getElementById('persist-data'); // Ensure this ID matches your toggle

        // Construct the settings object we WANT to save
        const requestedSettings = {
            alert_email: alertEmailInput ? alertEmailInput.value : "",
            enable_alerts: enableAlertsInput ? enableAlertsInput.checked : false,
            retention_days: retentionInput ? parseInt(retentionInput.value) : 30,
            data_persistence: persistInput ? persistInput.checked : true
        };

        // 3. Validation
        if (requestedSettings.enable_alerts && !requestedSettings.alert_email) {
            throw new Error("Please enter an email address to enable alerts.");
        }

        // 4. Send to "Request Change" API (Not direct save)
        const token = localStorage.getItem('authToken');
        
        // We wrap the settings in a payload with a specific TYPE
        const apiPayload = {
            type: 'SYSTEM_SETTINGS_UPDATE', 
            payload: requestedSettings
        };

        const res = await fetch(`${window.API_URL}/user/request-change`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(apiPayload)
        });

        // 5. Handle Response
        if (res.ok) {
            // Success Animation (Amber color to indicate "Pending Approval")
            if (btn) {
                btn.innerHTML = '<i class="fas fa-clock"></i> REQUEST SENT';
                btn.classList.remove('bg-purple-600/20', 'text-purple-400');
                btn.classList.add('bg-amber-600', 'text-white'); 
            }
            
            // Inform the user clearly
            alert("✅ Request Sent! An Admin must approve these changes before they apply.");

            // Revert Button after 3 seconds
            setTimeout(() => {
                if (btn) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                    btn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-amber-600', 'text-white');
                    btn.classList.add('bg-purple-600/20', 'text-purple-400');
                }
            }, 3000);
        } else {
            const errData = await res.json();
            throw new Error(errData.error || "Server rejected request.");
        }

    } catch (e) {
        console.error("Request Error:", e);
        alert(`❌ Request Failed: ${e.message}`);
        
        // Reset Button on Error
        if (btn) {
            btn.innerText = "ERROR";
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }, 2000);
        }
    }
};// Claim New Device
/* ============================================================
   DEVICE MANAGEMENT (With Safety URLs)
   ============================================================ */

// Claim New Device
window.claimNewMeter = async function() {
    const btn = document.getElementById('btn-claim');
    const statusEl = document.getElementById('claim-status');
    const idVal = document.getElementById('claim-device-id')?.value;
    const nameVal = document.getElementById('claim-device-name')?.value;

    if (!idVal || !nameVal) return alert("Please enter both Device ID and a Name.");

    btn.innerText = "VERIFYING...";
    btn.disabled = true;

    try {
        const token = localStorage.getItem('authToken');
        const API_ROOT = window.API_URL || "https://nexusgrid-api.onrender.com/api";
        
        const res = await fetch(`${API_ROOT}/devices/claim`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ deviceId: idVal, friendlyName: nameVal })
        });

        const data = await res.json();

        if (res.ok) {
            statusEl.innerText = "✅ SUCCESS! REFRESHING...";
            statusEl.className = "mt-4 text-xs font-bold text-center text-green-400 animate-pulse block";
            setTimeout(() => window.location.reload(), 2000);
        } else {
            throw new Error(data.error || "Claim failed");
        }
    } catch (e) {
        statusEl.innerText = `❌ ERROR: ${e.message}`;
        statusEl.className = "mt-4 text-xs font-bold text-center text-red-500 block";
        btn.innerText = "Link Device";
        btn.disabled = false;
    }
};

// Delete Device
window.deleteActiveMeter = async function() {
    if (!window.ACTIVE_METER_ID) return alert('⚠️ No meter selected.');

    const confirmed = confirm(`🚨 PERMANENT DELETION WARNING 🚨\n\nAre you sure you want to delete ${window.ACTIVE_METER_ID}?\nThis cannot be undone.`);
    if (!confirmed) return;

    try {
        const token = localStorage.getItem('authToken');
        const API_ROOT = window.API_URL || "https://nexusgrid-api.onrender.com/api";
        
        const res = await fetch(`${API_ROOT}/devices/${window.ACTIVE_METER_ID}`, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json' 
            }
        });

        if (res.ok) {
            alert(`✅ Device deleted.`);
            localStorage.removeItem('lastMeterId');
            window.location.reload();
        } else {
            throw new Error('Failed to delete device');
        }
    } catch (e) {
        alert(`❌ Error: ${e.message}`);
    }
};


/* ------------------------------------------------------------
   3. HISTORICAL DATA (Audit & Analytics)
   ------------------------------------------------------------ */

// Archive Tab: Fetch Audit Logs (Fixes ReferenceError)
window.fetchRangeAudit = async function() {
    const startEl = document.getElementById('start-date'); 
    const endEl = document.getElementById('end-date');
    const tbody = document.getElementById('audit-table-body');
    const spinner = document.getElementById('loading-spinner');

    if (!startEl?.value || !endEl?.value) {
        alert("Please select dates.");
        return;
    }

    if(spinner) spinner.classList.remove('hidden');
    if(tbody) tbody.innerHTML = '';

    try {
        const token = localStorage.getItem('authToken');
        const url = `${window.API_URL || ''}/history?start=${startEl.value}&end=${endEl.value}&deviceId=${window.ACTIVE_METER_ID}`;
        
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();

        if(!data || data.length === 0) {
            window.fullAuditData = [];
            if(tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-gray-400">No records found.</td></tr>';
            return;
        }

        // Save Global Data for PDF Export
        window.fullAuditData = data;

        // Render Table
        if(tbody) {
            data.slice(0, 100).forEach(row => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-700 hover:bg-slate-700/50 transition-colors";
                tr.innerHTML = `
                    <td class="p-3 text-slate-300 text-xs">${new Date(row.timestamp).toLocaleString()}</td>
                    <td class="p-3 text-blue-400 font-mono text-xs">${Number(row.active_power).toFixed(2)}</td>
                    <td class="p-3 text-purple-400 font-mono text-xs">${Number(row.apparent_power).toFixed(2)}</td>
                    <td class="p-3 text-slate-400 font-mono text-xs">${Number(row.power_factor).toFixed(3)}</td>
                    <td class="p-3 text-slate-400 font-mono text-xs">${Number(row.voltage_r).toFixed(1)} V</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error("Audit Fetch Error:", err);
        if(tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center text-red-400 py-4">Error: ${err.message}</td></tr>`;
    } finally {
        if(spinner) spinner.classList.add('hidden');
    }
};

// Analytics Tab: Deep Analytics Sync
window.syncDeepAnalytics = async function() {
    if (!window.ACTIVE_METER_ID) return;
    console.log(`📊 Syncing Deep Analytics for ${window.ACTIVE_METER_ID}...`);

    try {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${window.API_URL || ''}/history?range=7d&deviceId=${window.ACTIVE_METER_ID}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;
        const data = await res.json();
        
        if (!data || data.length === 0) {
            console.log("No historical data found for analytics.");
            return;
        }

        // BUCKETS
        const heatmapBuckets = new Array(168).fill(0); 
        const profileBuckets = [0, 0, 0, 0, 0, 0]; 
        const profileCounts = [0, 0, 0, 0, 0, 0];

        const now = new Date();
        const startWindow = new Date();
        startWindow.setDate(now.getDate() - 7);

        data.forEach(point => {
            const ts = new Date(point.timestamp);
            const val = Number(point.apparent_power || 0);

            // Heatmap
            const hoursDiff = Math.floor((ts - startWindow) / (1000 * 60 * 60));
            if (hoursDiff >= 0 && hoursDiff < 168) heatmapBuckets[hoursDiff] = val;

            // Profile
            const slot = Math.floor(ts.getHours() / 4);
            if (slot >= 0 && slot < 6) {
                profileBuckets[slot] += val;
                profileCounts[slot]++;
            }
        });

        // UI Updates
        heatmapBuckets.forEach((val, i) => {
            const cell = document.getElementById(`hm-cell-${i}`);
            if (cell) {
                const intensity = val / 500; 
                cell.className = "w-full h-4 rounded-sm border border-transparent transition-colors";
                if (intensity > 0.8) cell.classList.add("bg-red-500", "animate-pulse");
                else if (intensity > 0.5) cell.classList.add("bg-yellow-500");
                else if (intensity > 0.1) cell.classList.add("bg-green-500");
                else cell.classList.add("bg-slate-800");
                cell.title = `${val.toFixed(1)} kVA`;
            }
        });

        if (window.loadDensityChart) {
            const avgs = profileBuckets.map((sum, i) => profileCounts[i] ? sum / profileCounts[i] : 0);
            window.loadDensityChart.data.datasets[0].data = avgs;
            window.loadDensityChart.update();
        }

    } catch (err) {
        console.warn("Analytics Sync Error:", err);
    }
};



// Save Safety Thresholds
window.saveAllThresholds = async function() {
    if (!window.ACTIVE_METER_ID) return alert("No meter selected");

    const btn = document.getElementById('commit-btn');
    btn.innerHTML = `<span class="animate-pulse">SAVING...</span>`;
    btn.disabled = true;

    try {
        const payload = {
            v_ov: parseFloat(document.getElementById('v-ov').value),
            v_uv: parseFloat(document.getElementById('v-uv').value),
            v_imb: parseFloat(document.getElementById('v-imb').value),
            i_oc: parseFloat(document.getElementById('i-oc').value),
            i_imb: parseFloat(document.getElementById('i-imb').value),
            i_neu: parseFloat(document.getElementById('i-neu').value),
            t_int: parseFloat(document.getElementById('t-int').value),
            allotted_load: parseFloat(document.getElementById('allotted-load').value),
            pf_lag: parseFloat(document.getElementById('pf-lag').value),
            pf_lead: parseFloat(document.getElementById('pf-lead').value),
            alert_email: document.getElementById('alert-email')?.value,
            enable_email_alerts: document.getElementById('enable-alerts')?.checked
        };

        const token = localStorage.getItem('authToken');
        const res = await fetch(`${window.API_URL}/devices/${window.ACTIVE_METER_ID}/safety`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            btn.innerHTML = '<span>✓ RULES SAVED</span>';
            btn.classList.replace('bg-red-600', 'bg-green-600');
            await window.syncSafetyUI(); 
            setTimeout(() => { 
                btn.innerText = 'Commit Safety Boundaries'; 
                btn.classList.replace('bg-green-600', 'bg-red-600');
                btn.disabled = false; 
            }, 2000);
        } else {
            throw new Error("Server rejected settings");
        }
    } catch (e) {
        alert("Save Failed: " + e.message);
        btn.disabled = false;
        btn.innerText = "RETRY";
    }
};

// Sync Safety UI
window.syncSafetyUI = async function() {
    if (!window.ACTIVE_METER_ID) return;
    try {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${window.API_URL}/devices/${window.ACTIVE_METER_ID}/safety`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        
        if (res.ok) {
            const data = await res.json();
            const setVal = (id, val, def) => {
                const el = document.getElementById(id);
                if (el) el.value = (val !== null && val !== undefined) ? val : def;
            };

            setVal('v-ov', data.v_ov, 456);
            setVal('v-uv', data.v_uv, 373);
            setVal('v-imb', data.v_imb, 3);
            setVal('i-oc', data.i_oc, 110);
            setVal('i-imb', data.i_imb, 15);
            setVal('i-neu', data.i_neu, 30);
            setVal('t-int', data.t_int, 75);
            setVal('allotted-load', data.allotted_load, 500);
            setVal('pf-lag', data.pf_lag, 0.90);
            setVal('pf-lead', data.pf_lead, 0.98);
            setVal('alert-email', data.alert_email, '');
            const alertCheckbox = document.getElementById('enable-alerts');
            if (alertCheckbox) alertCheckbox.checked = data.enable_email_alerts || false;
        }
    } catch (e) { console.error("Safety Sync Error", e); }
};

// Rescheduler Functions
window.loadReschedulerSettings = async function(type) {
  try {
        const token = localStorage.getItem('authToken');
        const root = window.API_URL || "https://nexusgrid-api.onrender.com/api";
        const res = await fetch(`${root}/rescheduler?section=${type}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if(res.ok) {
            const setVal = (id, v) => { if(document.getElementById(id)) document.getElementById(id).value = v; };
            const setCheck = (id, v) => { if(document.getElementById(id)) document.getElementById(id).checked = v; };
            setVal(`rescheduler-email-${type}`, data.email);
            setCheck(`rescheduler-email-enabled-${type}`, data.emailEnabled);
            setVal(`rescheduler-date-${type}`, data.date);
            setVal(`rescheduler-time-${type}`, data.time);
            setVal(`rescheduler-frequency-${type}`, data.frequency);
        }
    } catch(e) { console.warn(`No schedule for ${type}`); }
};

window.saveReschedulerSettings = async function(type) {
    const btn = document.getElementById(`save-rescheduler-${type}-btn`);
    const originalText = btn.innerText;
    
    const email = document.getElementById(`rescheduler-email-${type}`)?.value;
    const enabled = document.getElementById(`rescheduler-email-enabled-${type}`)?.checked;
    const date = document.getElementById(`rescheduler-date-${type}`)?.value;
    const time = document.getElementById(`rescheduler-time-${type}`)?.value;
    const freq = document.getElementById(`rescheduler-frequency-${type}`)?.value;
    const statusEl = document.getElementById(`rescheduler-status-${type}`);

    if (!email || !date || !time) return alert("Please fill in all fields.");

    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${window.API_URL || ''}/rescheduler`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                section: type,
                emailEnabled: enabled,
                email: email,
                date: date,
                time: time,
                frequency: freq
            })
        });

        if (response.ok) {
            if (statusEl) {
                statusEl.classList.remove('hidden');
                statusEl.innerHTML = `<span class="text-green-400 font-bold">✅ Saved!</span> Next: ${date} @ ${time}`;
            }
        } else {
            throw new Error("Failed to save settings");
        }
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

// Archive Alarms Fetcher
/* ============================================================
   ARCHIVE ALARMS FETCHER (With Full Pagination)
   ============================================================ */
window.fetchAlarmsByDate = async function(page = 1) {
    const searchDate = document.getElementById('alarm-archive-date')?.value;
    const tableBody = document.getElementById('archive-table-body');
    const paginationRow = document.getElementById('archive-pagination');
    
    // UI Elements for Pagination
    const pageInfo = document.getElementById('arch-page-info');
    const totalCount = document.getElementById('arch-total-count');
    const btnPrev = document.getElementById('prev-arch-btn');
    const btnNext = document.getElementById('next-arch-btn');
    
    if (!searchDate) return alert('Please select a date first.');

    // Show Loading State
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="4" class="p-20 text-center text-indigo-400 animate-pulse text-[10px] font-bold uppercase">Retrieving Incident Logs...</td></tr>`;
    }

    try {
        const response = await fetch(`${window.API_URL}/alarms/archive?date=${searchDate}&page=${page}&limit=20&deviceId=${window.ACTIVE_METER_ID}`);
        
        if (!response.ok) throw new Error(`Server Error: ${response.status}`);
        
        const data = await response.json();
        const logs = data.logs || [];

        // 1. Handle No Data
        if (!logs.length) {
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="4" class="p-20 text-center text-gray-600 text-[10px] uppercase font-bold italic">No incidents recorded for this date.</td></tr>';
            if (paginationRow) paginationRow.classList.add('hidden');
            return;
        }

        // 2. Render Table Rows
        if (tableBody) tableBody.innerHTML = '';
        
        logs.forEach(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            let colorClass = 'text-white';
            if (log.level === 'CRITICAL' || log.level === 'DANGER') colorClass = 'text-red-400';
            else if (log.level === 'WARNING') colorClass = 'text-yellow-400';
            else colorClass = 'text-blue-400';

            tableBody.innerHTML += `
            <tr class="hover:bg-indigo-500/5 transition-colors border-b border-gray-800/20">
                <td class="p-4 text-gray-500 font-mono text-[10px]">${time}</td>
                <td class="p-4 font-bold text-[10px] ${colorClass}">${log.message}</td>
                <td class="p-4 text-center text-gray-300 font-bold text-[10px]">
                    ${log.value_at_time} / ${log.threshold_limit}
                </td>
                <td class="p-4 text-right">
                    <span class="text-[8px] font-black text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">
                        ARCHIVED
                    </span>
                </td>
            </tr>`;
        });

        // 3. Handle Pagination Controls
        if (data.totalPages > 1) {
            if (paginationRow) paginationRow.classList.remove('hidden');
            
            // Update Text
            if (pageInfo) pageInfo.innerText = `Page ${data.currentPage} of ${data.totalPages}`;
            if (totalCount) totalCount.innerText = `${data.total} TOTAL INCIDENTS`;
            
            // Enable/Disable Buttons
            if (btnPrev) {
                btnPrev.disabled = (data.currentPage <= 1);
                // Remove old listeners to prevent stacking
                btnPrev.onclick = () => window.fetchAlarmsByDate(data.currentPage - 1);
            }
            
            if (btnNext) {
                btnNext.disabled = (data.currentPage >= data.totalPages);
                btnNext.onclick = () => window.fetchAlarmsByDate(data.currentPage + 1);
            }
        } else {
            if (paginationRow) paginationRow.classList.add('hidden');
        }

    } catch (e) {
        console.error('fetchAlarmsByDate error', e);
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="4" class="p-20 text-center text-red-500 text-[10px] font-bold">CONNECTION FAILED</td></tr>';
    }
};

// Global Exports

window.initMeterSelector = initMeterSelector;







