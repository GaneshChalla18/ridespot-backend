const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'RideSpot backend is running 🚗' });
});

// ─── PRICE ESTIMATES ─────────────────────────────────────────────────────────
// GET /estimates?start_lat=40.7580&start_lng=-73.9855&end_lat=40.7484&end_lng=-73.9967
app.get('/estimates', async (req, res) => {
    const { start_lat, start_lng, end_lat, end_lng } = req.query;

    if (!start_lat || !start_lng || !end_lat || !end_lng) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    try {
        // Uber's internal price estimate endpoint (same one their website uses)
        const url = `https://www.uber.com/api/ridemap/getPriceEstimate`;

        const payload = {
            startLatitude: parseFloat(start_lat),
            startLongitude: parseFloat(start_lng),
            endLatitude: parseFloat(end_lat),
            endLongitude: parseFloat(end_lng),
            seatCount: 1,
        };

        const headers = {
            'Content-Type': 'application/json',
            'x-csrf-token': 'x',
            'Cookie': 'sid=; csid=',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'Origin': 'https://www.uber.com',
            'Referer': 'https://www.uber.com/',
        };

        const response = await axios.post(url, payload, { headers, timeout: 8000 });
        const data = response.data;

        // Parse ride options from Uber's response
        const rides = [];

        if (data && data.data && data.data.vehicleViewDetails) {
            data.data.vehicleViewDetails.forEach(vehicle => {
                rides.push({
                    name: vehicle.description || vehicle.displayName,
                    low: vehicle.fareEstimate?.lowerFareEstimate || null,
                    high: vehicle.fareEstimate?.upperFareEstimate || null,
                    eta: vehicle.etaString || null,
                });
            });
        }

        // If parsing failed or returned nothing, return simulated data
        // (remove this block once you confirm real data is working)
        if (rides.length === 0) {
            return res.json(simulatePrices(start_lat, start_lng));
        }

        res.json({ rides, source: 'uber' });

    } catch (err) {
        console.error('Uber fetch error:', err.message);
        // Fall back to simulated prices so the app never crashes
        res.json(simulatePrices(start_lat, start_lng));
    }
});

// ─── HEATMAP — multiple pickup points at once ─────────────────────────────────
// POST /heatmap  body: { pickups: [{lat, lng}], end_lat, end_lng }
app.post('/heatmap', async (req, res) => {
    const { pickups, end_lat, end_lng } = req.body;

    if (!pickups || !end_lat || !end_lng) {
        return res.status(400).json({ error: 'Missing data' });
    }

    try {
        // Fetch prices for all pickup points in parallel
        const results = await Promise.all(
            pickups.map(async (pickup) => {
                try {
                    const r = await axios.get(
                        `http://localhost:${PORT}/estimates?start_lat=${pickup.lat}&start_lng=${pickup.lng}&end_lat=${end_lat}&end_lng=${end_lng}`,
                        { timeout: 8000 }
                    );
                    const cheapest = getCheapestRide(r.data.rides);
                    return {
                        lat: pickup.lat,
                        lng: pickup.lng,
                        price: cheapest?.low || null,
                        rides: r.data.rides,
                    };
                } catch {
                    return {
                        lat: pickup.lat,
                        lng: pickup.lng,
                        price: simulateSinglePrice(pickup.lat, pickup.lng),
                        rides: [],
                    };
                }
            })
        );

        res.json({ points: results });
    } catch (err) {
        console.error('Heatmap error:', err.message);
        res.status(500).json({ error: 'Failed to fetch heatmap data' });
    }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getCheapestRide(rides) {
    if (!rides || rides.length === 0) return null;
    return rides.reduce((min, r) => (r.low < min.low ? r : min), rides[0]);
}

// Simulated prices for development / fallback
// Prices vary slightly based on coordinates to simulate surge zones
function simulatePrices(lat, lng) {
    const base = 11 + Math.random() * 6;

    // Simulate a surge zone at a specific offset
    const surgeLat = parseFloat(lat) + 0.003;
    const surgeLng = parseFloat(lng) + 0.003;
    const dist = Math.sqrt(
        Math.pow(parseFloat(lat) - surgeLat, 2) +
        Math.pow(parseFloat(lng) - surgeLng, 2)
    );
    const surge = dist < 0.004 ? 8 : 0;

    const uberX = +(base + surge).toFixed(2);
    const uberXL = +(uberX * 1.6).toFixed(2);
    const uberComfort = +(uberX * 1.3).toFixed(2);

    return {
        source: 'simulated',
        rides: [
            { name: 'UberX', low: uberX, high: +(uberX + 2).toFixed(2), eta: '3 min' },
            { name: 'Comfort', low: uberComfort, high: +(uberComfort + 2).toFixed(2), eta: '5 min' },
            { name: 'UberXL', low: uberXL, high: +(uberXL + 3).toFixed(2), eta: '7 min' },
        ],
    };
}

function simulateSinglePrice(lat, lng) {
    return +(11 + Math.random() * 10).toFixed(2);
}

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ RideSpot backend running on port ${PORT}`);
});