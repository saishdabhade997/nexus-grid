/* ============================================================
   BILLING & EXPORT LOGIC (billing.js) - FINAL COMPLETE VERSION
   ============================================================ */

/* ------------------------------------------------------------
   1. GLOBAL STATE & CONFIGURATION
   ------------------------------------------------------------ */
// The "Grand Total" Memory - Remembers history + adds live ticks
window.BILLING_STATE = {
    totalEnergyCost: 0,
    totalUnits: 0,
    peakDemand: 0,
    penalties: 0,
    fixedCost: 0,
    finalBill: 0,
    taxPercent: 18,
    contractLimit: 500,
    demandRate: 280
};

// Data for Charts & Loading Flags
window.billingRangeData = [];
window.isBillingLoading = false;
window.lastLiveUpdate = new Date(); 
let chartUpdateTimer = null;

/* ------------------------------------------------------------
   2. HELPER: SHARED TARIFF LOGIC
   ------------------------------------------------------------ */
function getTariffRate(dateObj) {
    const hour = dateObj.getHours();
    const config = window.TARIFF_CONFIG || {};
    const shifts = config.shifts || {};
    
    // Default: Shift A
    let rate = shifts.A?.rate || 7.5;
    
    // Check Shift B (Evening)
    if (shifts.B?.start !== undefined && shifts.B?.end !== undefined) {
        const start = parseInt(shifts.B.start);
        const end = parseInt(shifts.B.end);
        if (hour >= start && hour < end) return shifts.B.rate || 9.5;
    }
    
    // Check Shift C (Night)
    if (shifts.C?.start !== undefined && shifts.C?.end !== undefined) {
        const start = parseInt(shifts.C.start);
        const end = parseInt(shifts.C.end);
        if (start > end) { // Crossover (e.g. 22 to 06)
            if (hour >= start || hour < end) return shifts.C.rate || 5.5;
        } else {
            if (hour >= start && hour < end) return shifts.C.rate || 5.5;
        }
    }
    return rate;
}

/* ------------------------------------------------------------
   3. CHART DEBOUNCER (Prevents Lag)
   ------------------------------------------------------------ */
function debouncedChartUpdate(data) {
    clearTimeout(chartUpdateTimer);
    chartUpdateTimer = setTimeout(() => {
        if (typeof window.updateBillingCharts === 'function') {
            window.updateBillingCharts(data);
        }
    }, 2000); 
}

/* ------------------------------------------------------------
   4. MAIN CALCULATION ENGINE (Fetches History)
   ------------------------------------------------------------ */
window.calculateBillingRange = async function(isLiveMode = false) {
    if (window.isBillingLoading) return;
    
    const startDate = document.getElementById('billing-start-date')?.value;
    const endDate = document.getElementById('billing-end-date')?.value;
    const displayEl = document.getElementById('billing-period-display');

    if (!startDate || !endDate) {
        alert('Please select both start and end dates.');
        return;
    }

    window.isBillingLoading = true;
    
    // UI Loading State
    if (displayEl) {
        const todayStr = new Date().toISOString().split('T')[0];
        const isLive = (startDate === endDate && startDate === todayStr);
        displayEl.innerHTML = `
            <div class="text-center">
                <div class="text-sm text-slate-400 mb-1">Analysis Period</div>
                <div class="text-xl font-bold text-white mb-2">${startDate}</div>
                <div class="text-xs text-blue-400 animate-pulse">${isLive ? 'Initializing Live Feed...' : 'Fetching History...'}</div>
            </div>`;
    }

    try {
        const token = localStorage.getItem('authToken');
        const url = `${window.API_URL || ''}/history?start=${startDate}&end=${endDate}&deviceId=${window.ACTIVE_METER_ID}`;
        
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Server Error: ${res.status}`);

        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Invalid data format");

        window.billingRangeData = data; // Store full history initially for charts

        // ✅ CRITICAL: Calculate the Baseline
        if (data.length === 0) {
            console.log("⚠️ No history found. Baseline is 0.");
            analyzeRangeBilling([]); 
        } else {
            console.log(`📊 Loaded History: ${data.length} points.`);
            analyzeRangeBilling(data); // This sets window.BILLING_STATE
        }

        // Final UI Badge
        if (displayEl) {
            const todayStr = new Date().toISOString().split('T')[0];
            const isLive = (startDate === endDate && startDate === todayStr);
            const statusHtml = isLive 
                ? `<span class="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded animate-pulse">● LIVE TRACKING</span>`
                : `<span class="text-xs text-emerald-400">✓ Computation Complete</span>`;
            
            displayEl.innerHTML = `
                <div class="text-center">
                    <div class="text-sm text-slate-400 mb-1">Analysis Period</div>
                    <div class="text-xl font-bold text-white mb-2">${startDate} to ${endDate}</div>
                    ${statusHtml}
                </div>`;
        }

    } catch (err) {
        console.error('Billing Error:', err);
        if (displayEl) displayEl.innerHTML = `<div class="text-red-400 text-xs">${err.message}</div>`;
    } finally {
        window.isBillingLoading = false;
        window.lastLiveUpdate = new Date(); // Reset integration timer
    }
};
/* ------------------------------------------------------------
   HELPER: Recalculate Bill when Settings Change
   (Call this from your HTML input onchange events)
   ------------------------------------------------------------ */
window.recalculateFromUI = function() {
    console.log("🔄 Settings changed. Recalculating...");
    
    // Check if we have data loaded
    if (window.billingRangeData && window.billingRangeData.length > 0) {
        // Re-run the analysis with the existing data and NEW input values
        analyzeRangeBilling(window.billingRangeData);
    } else {
        console.warn("⚠️ No data to recalculate.");
    }
};
function analyzeRangeBilling(data) {
    const uiDemand = document.getElementById('fixed-contract-demand')?.value;
    const uiRate   = document.getElementById('fixed-demand-charge')?.value;
    const uiTax    = document.getElementById('fixed-tax-rate')?.value;

    const contractLimit = Number(uiDemand) || 500; 
    const demandRate    = Number(uiRate)   || 280;      
    const taxPercent    = Number(uiTax)    || 18; 

    // ✅ Initialize shifts to prevent "undefined" errors in charts.js
    const analysis = {
        A: { units: 0, cost: 0 },
        B: { units: 0, cost: 0 },
        C: { units: 0, cost: 0 },
        totalEnergy: 0, 
        totalCost: 0, 
        peakDemand: 0, 
        penalties: 0, 
        dailyCosts: new Map()
    };

    if (Array.isArray(data) && data.length > 0) {
        data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        data.forEach((point, index) => {
            const ts = new Date(point.timestamp);
            const kva = Number(point.apparent_power || 0);
            if (kva > analysis.peakDemand) analysis.peakDemand = kva;

            let durationHours = 0;
            if (index === 0) {
                durationHours = 1 / 60; 
            } else {
                const prevTs = new Date(data[index - 1].timestamp);
                const diffMs = ts - prevTs;
                durationHours = diffMs / (1000 * 60 * 60); 
                if (durationHours > 0.25) durationHours = 1 / 60; 
                if (durationHours < 0) durationHours = 0;
            }

            const unit_kvah = kva * durationHours; 
            const rate = getTariffRate(ts); // Using your helper
            const cost = unit_kvah * rate;

            // ✅ Determine which shift to attribute the cost to for the chart
            const hour = ts.getHours();
            let shiftKey = 'A'; 
            const config = window.TARIFF_CONFIG || {};
            const shifts = config.shifts || {};
            
            if (shifts.B && hour >= parseInt(shifts.B.start) && hour < parseInt(shifts.B.end)) shiftKey = 'B';
            if (shifts.C && (hour >= 22 || hour < 6)) shiftKey = 'C';

            analysis[shiftKey].units += unit_kvah;
            analysis[shiftKey].cost += cost;
            analysis.totalEnergy += unit_kvah;
            analysis.totalCost += cost;
            
            const dateKey = ts.toISOString().split('T')[0];
            analysis.dailyCosts.set(dateKey, (analysis.dailyCosts.get(dateKey) || 0) + cost);
        });
    }

    // Calculate Fixed Components
    if (analysis.peakDemand > contractLimit) {
        analysis.penalties = (analysis.peakDemand - contractLimit) * (demandRate * 2);
    }

    const billableDemand = Math.max(analysis.peakDemand, contractLimit);
    const monthlyFixed = billableDemand * demandRate;
    const daysSelected = Math.max(1, analysis.dailyCosts.size || 1); 
    const proRatedFixed = (monthlyFixed / 30) * daysSelected;

    const subTotal = analysis.totalCost + analysis.penalties + proRatedFixed;
    const finalBill = subTotal * (1 + (taxPercent / 100));

    // ✅ UPDATE GLOBAL STATE
    window.BILLING_STATE = {
        totalEnergyCost: analysis.totalCost,
        totalUnits: analysis.totalEnergy,
        peakDemand: analysis.peakDemand,
        penalties: analysis.penalties,
        fixedCost: proRatedFixed,
        finalBill: finalBill,
        taxPercent: taxPercent,
        contractLimit: contractLimit,
        demandRate: demandRate
    };

    console.log(`💰 Baseline Set: ₹ ${finalBill.toFixed(2)}`);
    updateBillingUI_FromState();

    // ✅ THE FIX: Structure data exactly for charts.js
    const chartCompatibleData = {
        A: analysis.A,
        B: analysis.B,
        C: analysis.C,
        dailyCosts: dailyCostsObj,
        totalEnergy: analysis.totalEnergy,
        finalBill: finalBill
    };

    debouncedChartUpdate(chartCompatibleData); 
}

/* ------------------------------------------------------------
   6. LIVE HANDLER (Accumulates State. Never Recalculates.)
   ------------------------------------------------------------ */
window.handleLiveBillingUpdate = function(socketData) {
    if (window.isBillingLoading) return; // Don't interrupt loading

    // Validate Date (Timezone Safe)
    const startInput = document.getElementById('billing-start-date');
    const endInput = document.getElementById('billing-end-date');
    if (!startInput || !endInput) return;
    const today = new Date().toISOString().split('T')[0];
    const userStart = new Date(startInput.value).toISOString().split('T')[0];
    const userEnd = new Date(endInput.value).toISOString().split('T')[0];
    if (userStart !== today || userEnd !== today) return;

    // 1. Calculate Tick Cost (Integration)
    const now = new Date();
    const diffMs = now - window.lastLiveUpdate;
    window.lastLiveUpdate = now;
    const durationHours = Math.min(diffMs / (1000 * 60 * 60), 1 / 60);

    const kva = Number(socketData.apparent_power || 0);
    const unit_kvah = kva * durationHours;
    const rate = getTariffRate(now);
    const tickCost = unit_kvah * rate;

    // 2. ✅ UPDATE STATE (Accumulate)
    const S = window.BILLING_STATE;

    S.totalEnergyCost += tickCost;
    S.totalUnits += unit_kvah;

    // Check for new Peak Demand (MD)
    if (kva > S.peakDemand) {
        S.peakDemand = kva;
        // Recalculate Penalty
        if (S.peakDemand > S.contractLimit) {
            S.penalties = (S.peakDemand - S.contractLimit) * (S.demandRate * 2);
        }
    }

    // Recalculate Final Bill: (Energy + Penalties + Fixed) * Tax
    const subTotal = S.totalEnergyCost + S.penalties + S.fixedCost;
    S.finalBill = subTotal * (1 + (S.taxPercent / 100));

    // 3. Update UI (Fast)
    updateBillingUI_FromState();

    // 4. ✅ PREPARE DATA FOR CHARTS (Fixes the "undefined reading cost" error)
    // We pass the current state but ensure A, B, and C properties exist
    const chartUpdateData = {
        A: { cost: S.totalEnergyCost, units: S.totalUnits }, // Live accumulation usually shown in main shift
        B: { cost: 0, units: 0 }, // Placeholder to prevent charts.js from crashing
        C: { cost: 0, units: 0 }, // Placeholder to prevent charts.js from crashing
        totalEnergy: S.totalUnits,
        finalBill: S.finalBill
    };

    // Update charts with safe data structure
    debouncedChartUpdate(chartUpdateData);

    // 5. Array Management (For Charts Only - Safe to Drop)
    if (!Array.isArray(window.billingRangeData)) window.billingRangeData = [];
    
    const newPoint = {
        timestamp: now.toISOString(),
        active_power: Number(socketData.active_power || 0),
        apparent_power: kva,
        power_factor: Number(socketData.power_factor || 0)
    };
    
    window.billingRangeData.push(newPoint);
    
    // Keep charts memory usage low
    if (window.billingRangeData.length > 2000) {
        window.billingRangeData.shift();
    }
};

/* ------------------------------------------------------------
   7. UI UPDATER (Reads from Global State Only)
   ------------------------------------------------------------ */
function updateBillingUI_FromState() {
    const S = window.BILLING_STATE;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    // Update Main Boxes
    setVal('cost-energy', `₹ ${S.totalEnergyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setVal('cost-penalty', `₹ ${S.penalties.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setVal('cost-md', `₹ ${S.fixedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    setVal('md-peak-text', `MD Peak: ${S.peakDemand.toFixed(1)} kVA`);

    // Average Rate
    const avgRate = S.totalUnits > 0 ? (S.finalBill / S.totalUnits).toFixed(2) : "0.00";
    const rateEl = document.getElementById('avg-unit-rate');
    if (rateEl) rateEl.innerText = `₹ ${avgRate}`;

    // Cycle Projection
    const date = new Date();
    const currentDay = date.getDate();
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    // Projection = Current Total / Days Passed * Days in Month
    const projectedTotal = (S.finalBill / Math.max(1, currentDay)) * daysInMonth;

    const projEl = document.getElementById('cycle-projection');
    if (projEl) {
        projEl.innerHTML = `Cycle Projection: <span class="text-emerald-400 font-bold">₹ ${projectedTotal.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>`;
    }

    // Insights
    setVal('cost-per-unit', `₹ ${avgRate}`);
    let efficiencyScore = avgRate > 0 ? Math.max(0, Math.min(100, 100 - ((avgRate - 7.5) * 5))) : 100;
    
    const effBadge = document.getElementById('efficiency-badge');
    const effBar = document.getElementById('efficiency-bar');
    if (effBadge) {
        if (efficiencyScore >= 80) { effBadge.innerText = "OPTIMAL"; effBadge.className = "px-2 py-1 bg-teal-500/20 text-teal-400 text-[8px] font-black rounded uppercase"; } 
        else if (efficiencyScore >= 50) { effBadge.innerText = "AVERAGE"; effBadge.className = "px-2 py-1 bg-amber-500/20 text-amber-400 text-[8px] font-black rounded uppercase"; } 
        else { effBadge.innerText = "POOR"; effBadge.className = "px-2 py-1 bg-red-500/20 text-red-400 text-[8px] font-black rounded uppercase"; }
    }
    setVal('efficiency-percent', `${efficiencyScore.toFixed(0)}%`);
    if (effBar) effBar.style.width = `${efficiencyScore}%`;
}

/* ------------------------------------------------------------
   8. PDF EXPORT (Uses Global State)
   ------------------------------------------------------------ */
window.generateBillingPDF = function() {
    console.log("📄 Generating Billing Statement...");
    const S = window.BILLING_STATE;

    const startStr = document.getElementById('billing-start-date')?.value || "N/A";
    const endStr = document.getElementById('billing-end-date')?.value || "N/A";

    if (!window.jspdf) { alert("PDF Library not loaded."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    const colorPrimary = [15, 23, 42]; 

    // Header
    doc.setFillColor(...colorPrimary);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(255, 255, 255);
    doc.text("ELECTRICITY BILL STATEMENT", 15, 20);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Period: ${startStr} to ${endStr}`, 15, 30);
    
    // Summary
    let yPos = 55;
    const drawRow = (label, value) => {
        doc.setTextColor(0, 0, 0); doc.text(label, 20, yPos);
        doc.text(value, 190, yPos, { align: "right" });
        yPos += 10;
        doc.setDrawColor(220); doc.line(20, yPos - 6, 190, yPos - 6);
    };

    doc.setFontSize(12); doc.setTextColor(59, 130, 246); doc.text("Cost Breakdown", 15, yPos - 5); yPos += 5;
    
    drawRow("Energy Charges", `Rs. ${S.totalEnergyCost.toFixed(2)}`);
    drawRow("Fixed Demand Charges", `Rs. ${S.fixedCost.toFixed(0)}`);
    doc.setTextColor(S.penalties > 0 ? 220 : 0, 0, 0); 
    drawRow("Penalties", `Rs. ${S.penalties.toFixed(2)}`);
    
    yPos += 5; doc.setFontSize(14); doc.setTextColor(0, 0, 0);
    doc.text("NET PAYABLE AMOUNT (Inc. Tax)", 20, yPos);
    doc.setTextColor(59, 130, 246);
    doc.text(`Rs. ${S.finalBill.toLocaleString(undefined, {minimumFractionDigits: 2})}`, 190, yPos, { align: "right" });

    // Footer
    doc.setFontSize(8); doc.setTextColor(150);
    doc.text("NexusGrid Enterprise Platform", 105, 285, { align: "center" });

    doc.save(`NexusGrid_Bill_${startStr}.pdf`);
};

/* ------------------------------------------------------------
   9. CSV EXPORT & AUDIT
   ------------------------------------------------------------ */
window.downloadAuditReport = function(format) {
    const data = window.fullAuditData || window.billingRangeData;
    if (!data || data.length === 0) {
        alert("Please fetch data first.");
        return;
    }
    if (format === 'csv') {
        exportToCSV(data, `Audit_Log_${window.ACTIVE_METER_ID}`);
    } 
};

function exportToCSV(data, filename) {
    if (!data || !Array.isArray(data) || data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(f => {
            const val = row[f];
            return (val === null || val === undefined) ? '' : `"${String(val).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) { 
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}.csv`);
        link.click();
    }
}

/* ------------------------------------------------------------
   10. AUTO-INIT (Triple Lock)
   ------------------------------------------------------------ */
window.setQuickRange = function(type) {
    const startInput = document.getElementById('billing-start-date');
    const endInput = document.getElementById('billing-end-date');
    const today = new Date().toISOString().split('T')[0];

    endInput.value = today;

    if (type === 'today') {
        startInput.value = today;
        window.calculateBillingRange(true);
    } else {
        if (type === 'week') {
            const d = new Date(); d.setDate(d.getDate() - 7);
            startInput.value = d.toISOString().split('T')[0];
        } else if (type === 'month') {
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            startInput.value = d.toISOString().split('T')[0];
        }
        window.calculateBillingRange(false);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const billingDisplay = document.getElementById('billing-period-display');
    if (billingDisplay) {
        // Triple Lock Strategy
        const forceToday = () => {
            const todayStr = new Date().toISOString().split('T')[0];
            const startInput = document.getElementById('billing-start-date');
            const endInput = document.getElementById('billing-end-date');
            if (startInput) startInput.value = todayStr;
            if (endInput) endInput.value = todayStr;
        };
        forceToday(); 
        setTimeout(() => forceToday(), 100); 
        setTimeout(() => {
            forceToday();
            if (typeof window.setQuickRange === 'function') window.setQuickRange('today');
        }, 500);
    }
});