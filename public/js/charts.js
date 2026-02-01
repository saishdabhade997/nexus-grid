/* ============================================================
   CHART INITIALIZATION & LOGIC
   ============================================================ */

/**
 * 1. Initialize Main Power Analytics Chart (Line Chart)
 */
window.initAnalyticsCharts = function() {
    const ctx = document.getElementById('analyticsMasterChart');
    if (!ctx) return;

    if (window.mainAnalyticsChart) window.mainAnalyticsChart.destroy();

    window.mainAnalyticsChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Active Power (kW)',
                    data: [],
                    borderColor: window.CONFIG.colorActive || '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.08)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2
                },
                {
                    label: 'Apparent Power (kVA)',
                    data: [],
                    borderColor: window.CONFIG.colorApparent || '#a855f7',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                y: { 
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' }, 
                    ticks: { color: '#94a3b8' }
                },
                x: { display: false } // Hide X labels
            }
        }
    });
};

/**
 * 2. Initialize Advanced Charts (Correlation, Density, Comparison)
 */
window.initAdvancedCharts = function() {
    // A. Correlation Scatter Chart
    const scatterCtx = document.getElementById('correlationChart');
    if (scatterCtx) {
        if (window.correlationChartInstance) window.correlationChartInstance.destroy();
        
        window.correlationChartInstance = new Chart(scatterCtx.getContext('2d'), {
            type: 'scatter',
            data: { 
                datasets: [{ 
                    label: 'Real-time Correlation', 
                    data: [], 
                    backgroundColor: '#10b981', 
                    pointRadius: 3 
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
               // In charts.js -> initAdvancedCharts
scales: {
    x: { 
        // NO min: 210, NO max: 250
        title: { display: true, text: 'Voltage (V)' },
        grid: { color: 'rgba(255,255,255,0.05)' } 
    },
    y: { 
        title: { display: true, text: 'Power Factor' },
        grid: { color: 'rgba(255,255,255,0.05)' } 
    }
},
                plugins: { legend: { display: false } }
            }
        });
    }

    // B. Load Density Chart (Bar)
    const densityCtx = document.getElementById('loadDensityChart');
    if (densityCtx) {
        if (window.loadDensityChart) window.loadDensityChart.destroy();
        
        window.loadDensityChart = new Chart(densityCtx.getContext('2d'), {
            type: 'bar',
            data: { 
                labels: ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'], 
                datasets: [{ 
                    label: 'Avg Energy (kWh)', 
                    data: [0, 0, 0, 0, 0, 0], 
                    backgroundColor: '#3b82f6', 
                    borderRadius: 4, 
                    barThickness: 20 
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }},
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // C. Comparison Chart (Doughnut) - RESTORED
    const compareCtx = document.getElementById('comparisonChart');
    if (compareCtx) {
        if (window.comparisonChart) window.comparisonChart.destroy();
        
        window.comparisonChart = new Chart(compareCtx.getContext('2d'), {
            type: 'doughnut',
            data: { 
                labels: ['Yesterday', 'Today'], 
                datasets: [{ 
                    data: [0, 0], 
                    backgroundColor: ['#64748b', '#3b82f6'],
                    borderWidth: 0
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '70%', 
                plugins: { legend: { display: false } }
            }
        });
    }
};
/* ============================================================
   BILLING CHARTS (Safe Update Logic)
   ============================================================ */
window.updateBillingCharts = function(analysis) {
    if (!analysis) return;

    // --- CHART 1: COST BREAKDOWN (Doughnut) ---
    const pieCanvas = document.getElementById('costBreakdownChart');
    if (pieCanvas) {
        // 🛡️ SAFETY CHECK: Only destroy if it's a valid Chart instance
        if (window.costBreakdownChart && typeof window.costBreakdownChart.destroy === 'function') {
            window.costBreakdownChart.destroy();
        }

        window.costBreakdownChart = new Chart(pieCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Shift A', 'Shift B', 'Shift C', 'Penalties'],
                datasets: [{
                    data: [analysis.A.cost, analysis.B.cost, analysis.C.cost, analysis.penalties],
                    backgroundColor: ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true, 
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ₹ ${ctx.raw.toFixed(2)}`
                        }
                    }
                }
            }
        });
    }

    // --- CHART 2: DAILY COST TREND (Line) ---
const trendCanvas = document.getElementById('dailyCostTrendChart');
if (trendCanvas && analysis.dailyCosts) {
    if (window.dailyCostTrendChart && typeof window.dailyCostTrendChart.destroy === 'function') {
        window.dailyCostTrendChart.destroy();
    }
    
    // ✅ FIX: Handle both Object and Map formats safely
    let sortedDates = [];
    let dailyValues = [];

    if (analysis.dailyCosts instanceof Map) {
        sortedDates = Array.from(analysis.dailyCosts.keys()).sort();
        dailyValues = sortedDates.map(date => analysis.dailyCosts.get(date));
    } else {
        // Handle plain Object format
        sortedDates = Object.keys(analysis.dailyCosts).sort();
        dailyValues = sortedDates.map(date => analysis.dailyCosts[date]);
    }

    const labels = sortedDates.map(date => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    
    window.dailyCostTrendChart = new Chart(trendCanvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Cost (₹)',
                data: dailyValues,
                borderColor: '#f97316',
                backgroundColor: 'rgba(249, 115, 22, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}
};
window.updateTimeRange = async function(range) {
    console.log(`📊 Switching Chart Range to: ${range}`);

    // 1. UI Navigation Reset
    const btnIds = ['btn-live', 'btn-1h', 'btn-24h', 'btn-7d', 'btn-30d'];
    btnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = "whitespace-nowrap px-4 py-2 text-xs font-bold text-gray-500 hover:text-white transition-all cursor-pointer";
    });

    const activeBtnId = range === 'live' ? 'btn-live' : `btn-${range}`;
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) activeBtn.className = "whitespace-nowrap px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg transition-all shadow-lg shadow-blue-500/20 cursor-pointer";

    // 2. Handle Live Mode Switch
    if (range === 'live') {
        window.isLiveMode = true;
        // Reset charts for fresh live stream
        if (window.mainAnalyticsChart) {
            window.mainAnalyticsChart.data.labels = [];
            window.mainAnalyticsChart.data.datasets.forEach(d => d.data = []);
            window.mainAnalyticsChart.update();
        }
        if (window.correlationChartInstance) {
            window.correlationChartInstance.data.datasets[0].data = [];
            window.correlationChartInstance.update();
        }
        return;
    }

    // 3. Historical Fetch & Plotting
    window.isLiveMode = false;
    try {
        const token = localStorage.getItem('authToken');
        // The server provides high-res for 1h/24h and AVG for 7d/30d
        const url = `${window.API_URL || ''}/history?range=${range}&deviceId=${window.ACTIVE_METER_ID}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (!res.ok) throw new Error("History fetch failed");
        const dbData = await res.json();

        // Prepare Line Chart
        if (window.mainAnalyticsChart) {
            window.mainAnalyticsChart.data.labels = [];
            window.mainAnalyticsChart.data.datasets.forEach(d => d.data = []);
        }

        // Prepare Correlation Scatter Chart
        if (window.correlationChartInstance) {
            window.correlationChartInstance.data.datasets[0].data = [];
        }

        // 4. Process and Push Data
        dbData.forEach(d => {
            const label = (range === '1h' || range === '24h') 
                ? new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date(d.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

            // Update Line Chart
            if (window.mainAnalyticsChart) {
                window.mainAnalyticsChart.data.labels.push(label);
                window.mainAnalyticsChart.data.datasets[0].data.push(Number(d.active_power || 0));
                window.mainAnalyticsChart.data.datasets[1].data.push(Number(d.apparent_power || 0));
            }

            // Update V vs PF Scatter Chart (Averaged via server for long ranges)
            if (window.correlationChartInstance) {
                window.correlationChartInstance.data.datasets[0].data.push({
                    x: Number(d.voltage_r || 0),
                    y: Number(d.power_factor || 0)
                });
            }
        });

        // 5. Finalize UI Update
        if (window.mainAnalyticsChart) window.mainAnalyticsChart.update('none');
        if (window.correlationChartInstance) window.correlationChartInstance.update('none');

    } catch (err) {
        console.error('Analytics Update Error:', err);
    }
};
/**
 * 5. Handle Live Data Injection (Called from app.js)
 */
window.updateLiveCharts = function(data) {
    if (!window.isLiveMode) return;

    // A. Update Main Line Chart
    if (window.mainAnalyticsChart) {
        const time = new Date().toLocaleTimeString();
        
        // Add new data
        window.mainAnalyticsChart.data.labels.push(time);
        window.mainAnalyticsChart.data.datasets[0].data.push(data.active_power);
        window.mainAnalyticsChart.data.datasets[1].data.push(data.apparent_power);
        
        // Remove old data (Keep max 50 points)
        if (window.mainAnalyticsChart.data.labels.length > 50) {
            window.mainAnalyticsChart.data.labels.shift();
            window.mainAnalyticsChart.data.datasets[0].data.shift();
            window.mainAnalyticsChart.data.datasets[1].data.shift();
        }
        
        // Use 'none' mode for smooth animation
        window.mainAnalyticsChart.update('none'); 
    }

    // B. Update Correlation Chart
    if (window.correlationChartInstance) {
        window.correlationChartInstance.data.datasets[0].data.push({
            x: data.voltage_r,
            y: data.power_factor
        });
        
        // Keep max 100 points
        if (window.correlationChartInstance.data.datasets[0].data.length > 100) {
            window.correlationChartInstance.data.datasets[0].data.shift();
        }
        window.correlationChartInstance.update('none');
    }
};