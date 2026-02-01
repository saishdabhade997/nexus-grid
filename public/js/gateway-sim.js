/* ============================================================
   IOT GATEWAY SIMULATOR (The "Factory Brain")
   ------------------------------------------------------------
   Simulates: 1 Gateway reading 5 RS485 Meters
   Output: Sends JSON to NexusGrid Cloud via HTTP POST
   ============================================================ */

const axios = require('axios'); // You might need to install this: npm install axios

// CONFIGURATION
const SERVER_URL = 'http://localhost:3000/api/telemetry';
const GATEWAY_ID = 'GW_FACTORY_01';
const METER_COUNT = 1; // How many meters are connected to this Gateway?

// METER REGISTRY (Simulating physical RS485 addresses)
const meters = Array.from({ length: METER_COUNT }, (_, i) => ({
    deviceId: `meter_${String(i + 1).padStart(2, '0')}`, // meter_01, meter_02...
    address:  1,
    baseLoad: 500 + (Math.random() * 2000) // Randomize base load for variety
}));

console.log(`🚀 Gateway ${GATEWAY_ID} Online`);
console.log(`🔌 Connected to ${METER_COUNT} Industrial Meters via RS485`);
console.log(`📡 Streaming to: ${SERVER_URL}`);

// GENERATOR FUNCTION (Simulates reading Modbus Registers)
function readModbusMeter(meter) {
    // Randomize values slightly to look "live"
    const voltage = 230 + (Math.random() * 5 - 2.5);
    const loadFactor = (Math.random() * 0.2) + 0.8; // 80-100% load fluctuation
    const activePower = meter.baseLoad * loadFactor;
    const apparentPower = activePower / 0.95;
    const current = apparentPower / voltage;
    
    return {
        deviceId: meter.deviceId,
        gatewayId: GATEWAY_ID,
        timestamp: new Date().toISOString(),
        
        // Electrical Parameters
        voltage_r: parseFloat(voltage.toFixed(1)),
        voltage_y: parseFloat((voltage - 1.5).toFixed(1)),
        voltage_b: parseFloat((voltage + 1.2).toFixed(1)),
        
        current_r: parseFloat(current.toFixed(2)),
        current_y: parseFloat((current * 0.98).toFixed(2)),
        current_b: parseFloat((current * 1.02).toFixed(2)),
        current_n: parseFloat((current * 0.1).toFixed(2)), // Neutral current
        
        active_power: parseFloat(activePower.toFixed(2)),
        apparent_power: parseFloat(apparentPower.toFixed(2)),
        reactive_power: parseFloat((apparentPower * 0.3).toFixed(2)),
        power_factor: parseFloat((0.95 + (Math.random() * 0.04 - 0.02)).toFixed(3)),
        
        frequency: parseFloat((50 + (Math.random() * 0.1 - 0.05)).toFixed(2)),
        meter_temperature: parseFloat((45 + Math.random() * 5).toFixed(1)),
        
        // Harmonics (Simulated)
        v_thd_r: 1.2, i_thd_r: 3.5
    };
}

// MAIN LOOP (The "Polling Cycle")
setInterval(async () => {
    console.log(`\n--- ⏱️ Polling Cycle Start ---`);
    
    for (const meter of meters) {
        try {
            // 1. "Read" the meter
            const data = readModbusMeter(meter);
            
            // 2. Send to Cloud
            await axios.post(SERVER_URL, data);
            
            console.log(`✅ Sent: ${meter.deviceId} | ${data.active_power} kW | ${data.voltage_r} V`);
        } catch (error) {
            console.error(`❌ Failed: ${meter.deviceId} - ${error.message}`);
        }
    }
}, 3000); // Run every 3 seconds