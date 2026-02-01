/* ====== CHART INITIALIZATION & UPDATES ====== */

/**
 * Initialize main analytics chart
 */
function initAnalyticsCharts() {
  const ctx = document.getElementById('analyticsMasterChart');
  if (!ctx) return;
  if (mainAnalyticsChart) mainAnalyticsChart.destroy();

  mainAnalyticsChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Active Power (kW)',
        data: [],
        borderColor: CONFIG.colorActive,
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true,
        tension: 0.4
      },{
        label: 'Apparent Power (kVA)',
        data: [],
        borderColor: CONFIG.colorApparent,
        borderDash: [5,5],
        fill: false,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }},
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }},
        x: { grid: { display: false }, ticks: { color: '#94a3b8' }}
      }
    }
  });
}

/**
 * Initialize advanced charts (correlation, density, comparison)
 */
function initAdvancedCharts() {
  // Correlation scatter (id: correlationChart)
  const scatterCtx = document.getElementById('correlationChart');
  if (scatterCtx) {
    if (correlationChartInstance) correlationChartInstance.destroy();
    correlationChartInstance = new Chart(scatterCtx.getContext('2d'), {
      type: 'scatter',
      data: { datasets: [{ label: 'Real-time Correlation', data: [], backgroundColor: '#10b981', pointRadius: 4 }]},
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { min: 210, max: 250, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Voltage (V)', color: '#64748b' }, ticks: { color: '#94a3b8' } },
          y: { min: 0.5, max: 1.0, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Power Factor', color: '#64748b' }, ticks: { color: '#94a3b8' } }
        },
        plugins: { legend: { display: false }}
      }
    });
  }

  // Load density (id: loadDensityChart)
  const densityCtx = document.getElementById('loadDensityChart');
  if (densityCtx) {
    if (loadDensityChart) loadDensityChart.destroy();
    loadDensityChart = new Chart(densityCtx.getContext('2d'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Energy (kWh)', data: [], backgroundColor: '#3b82f6', borderRadius: 4, barThickness: 20 }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }},
          x: { grid: { display: false }, ticks: { color: '#94a3b8' }}
        },
        plugins: { legend: { display: false }}
      }
    });
  }

  // Optional comparison chart (if exists by id 'comparisonChart')
  const compareCtx = document.getElementById('comparisonChart');
  if (compareCtx) {
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(compareCtx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Yesterday','Today'], datasets: [{ data: [0,0], backgroundColor: ['#64748b','#3b82f6'] }]},
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }}}
    });
  }
}

/**
 * Update billing charts (cost breakdown and daily trend)
 */
function updateBillingCharts(analysis) {
  // 1. Cost Breakdown (Donut Chart)
  const pieCtx = document.getElementById('costBreakdownChart');
  if (pieCtx) {
    if (costBreakdownChart) costBreakdownChart.destroy();
    
    costBreakdownChart = new Chart(pieCtx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Shift A', 'Shift B', 'Shift C', 'Penalties'],
        datasets: [{
          data: [analysis.A.cost, analysis.B.cost, analysis.C.cost, analysis.penalties],
          backgroundColor: ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } }}
        }
      }
    });
  }

  // 2. Daily Trend (Line Chart)
  const trendCtx = document.getElementById('dailyCostTrendChart');
  if (trendCtx) {
    if (dailyCostTrendChart) dailyCostTrendChart.destroy();
    
    const sortedDates = Array.from(analysis.dailyCosts.keys()).sort();
    const dailyValues = sortedDates.map(date => analysis.dailyCosts.get(date));
    const labels = sortedDates.map(date => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    
    dailyCostTrendChart = new Chart(trendCtx.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Daily Cost',
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
        plugins: { legend: { display: false }},
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }},
          x: { grid: { display: false }, ticks: { color: '#94a3b8' }}
        }
      }
    });
  }
}

/**
 * Update time range for analytics charts
 */
window.updateTimeRange = async function(range) {
    try {
        // Reset Buttons UI
        const btnIds = ['btn-live', 'btn-1h', 'btn-24h', 'btn-7d', 'btn-30d'];
        btnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.className = "whitespace-nowrap px-4 py-2 text-xs font-bold text-gray-500 hover:text-white transition-all";
        });

        // Handle Live Mode
        if (range === 'live') {
            const liveBtn = document.getElementById('btn-live');
            if (liveBtn) {
                liveBtn.className = "whitespace-nowrap px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg transition-all shadow-lg shadow-blue-500/20";
            }
            isLiveMode = true;
            return;
        }

        // Handle History Mode
        isLiveMode = false;
        const activeBtn = document.getElementById(`btn-${range}`);
        if(activeBtn) {
            activeBtn.className = "whitespace-nowrap px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg transition-all shadow-lg shadow-blue-500/20";
        }

        // Fetch history data with device filter
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${API_URL}/history?range=${range}&deviceId=${ACTIVE_METER_ID}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("History fetch failed");
        const dbData = await res.json();

        // Update Charts
        if (mainAnalyticsChart) {
            mainAnalyticsChart.data.labels = [];
            mainAnalyticsChart.data.datasets.forEach(d => d.data = []);

            dbData.forEach(d => {
                const label = (range === '1h' || range === '24h') 
                    ? new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date(d.timestamp).toLocaleDateString();

                mainAnalyticsChart.data.labels.push(label);
                mainAnalyticsChart.data.datasets[0].data.push(Number(d.active_power || 0));
                mainAnalyticsChart.data.datasets[1].data.push(Number(d.apparent_power || 0));
            });
            mainAnalyticsChart.update();
        }
    } catch (err) {
        console.error('Analytics Update Error:', err);
    }
};
