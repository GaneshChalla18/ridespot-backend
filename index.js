const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'RideSpot backend is running 🚗' });
});

// ─── UBER RATE CARDS (real published rates) ───────────────────────────────────
// Source: Uber's publicly known pricing per city
const RATE_CARDS = {
  default: {
    uberX:    { base: 1.20, perMile: 1.05, perMin: 0.22, minFare: 5.00, bookingFee: 2.95 },
    comfort:  { base: 1.50, perMile: 1.40, perMin: 0.28, minFare: 7.00, bookingFee: 2.95 },
    uberXL:   { base: 2.00, perMile: 1.75, perMin: 0.35, minFare: 8.00, bookingFee: 2.95 },
  },
  chicago: {
    uberX:    { base: 1.20, perMile: 1.05, perMin: 0.22, minFare: 5.00, bookingFee: 2.95 },
    comfort:  { base: 1.50, perMile: 1.40, perMin: 0.28, minFare: 7.00, bookingFee: 2.95 },
    uberXL:   { base: 2.00, perMile: 1.75, perMin: 0.35, minFare: 8.00, bookingFee: 2.95 },
  },
  nyc: {
    uberX:    { base: 2.55, perMile: 1.75, perMin: 0.35, minFare: 8.00, bookingFee: 3.50 },
    comfort:  { base: 3.00, perMile: 2.20, perMin: 0.42, minFare: 10.00, bookingFee: 3.50 },
    uberXL:   { base: 3.50, perMile: 2.85, perMin: 0.50, minFare: 12.00, bookingFee: 3.50 },
  },
  la: {
    uberX:    { base: 1.00, perMile: 1.23, perMin: 0.23, minFare: 5.00, bookingFee: 2.95 },
    comfort:  { base: 1.50, perMile: 1.55, perMin: 0.30, minFare: 7.00, bookingFee: 2.95 },
    uberXL:   { base: 2.00, perMile: 1.95, perMin: 0.38, minFare: 8.00, bookingFee: 2.95 },
  },
  sf: {
    uberX:    { base: 1.00, perMile: 1.35, perMin: 0.28, minFare: 6.00, bookingFee: 3.25 },
    comfort:  { base: 1.50, perMile: 1.70, perMin: 0.35, minFare: 8.00, bookingFee: 3.25 },
    uberXL:   { base: 2.00, perMile: 2.15, perMin: 0.42, minFare: 10.00, bookingFee: 3.25 },
  },
};

// ─── DETECT CITY FROM COORDINATES ────────────────────────────────────────────
function detectCity(lat, lng) {
  if (lat > 41.5 && lat < 42.5 && lng > -88.5 && lng < -87.3) return 'chicago';
  if (lat > 40.4 && lat < 41.0 && lng > -74.3 && lng < -73.6) return 'nyc';
  if (lat > 33.6 && lat < 34.4 && lng > -118.7 && lng < -117.9) return 'la';
  if (lat > 37.3 && lat < 37.9 && lng > -122.6 && lng < -122.0) return 'sf';
  return 'default';
}

// ─── HAVERSINE DISTANCE (miles) ───────────────────────────────────────────────
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── ESTIMATE DRIVE TIME (minutes) ───────────────────────────────────────────
// Assumes avg 20mph in city traffic
function estimateMinutes(miles) {
  return miles / 20 * 60;
}

// ─── SURGE MULTIPLIER ─────────────────────────────────────────────────────────
// Based on time of day — peaks during rush hours and late night
function getSurgeMultiplier() {
  const hour = new Date().getHours();
  if (hour >= 7 && hour <= 9)   return 1.2 + Math.random() * 0.3;  // Morning rush
  if (hour >= 17 && hour <= 19) return 1.3 + Math.random() * 0.4;  // Evening rush
  if (hour >= 22 || hour <= 2)  return 1.4 + Math.random() * 0.5;  // Late night
  return 1.0 + Math.random() * 0.1; // Normal times — slight variance
}

// ─── CALCULATE FARE ───────────────────────────────────────────────────────────
function calculateFare(rateCard, miles, minutes, surge) {
  const raw = rateCard.base + (rateCard.perMile * miles) + (rateCard.perMin * minutes);
  const withSurge = raw * surge;
  const total = Math.max(withSurge, rateCard.minFare) + rateCard.bookingFee;

  // Low and high estimate (±10%)
  const low  = +(total * 0.92).toFixed(2);
  const high = +(total * 1.08).toFixed(2);
  return { low, high };
}

// ─── ESTIMATE ETA (based on nearest drivers — simulated) ─────────────────────
function estimateETA(rideType) {
  const base = { uberX: 3, comfort: 5, uberXL: 7 };
  const variance = Math.floor(Math.random() * 3);
  return `${base[rideType] + variance} min`;
}

// ─── MAIN PRICE FUNCTION ──────────────────────────────────────────────────────
function estimatePrices(startLat, startLng, endLat, endLng) {
  const miles = distanceMiles(startLat, startLng, endLat, endLng);
  const minutes = estimateMinutes(miles);
  const surge = getSurgeMultiplier();
  const city = detectCity(startLat, startLng);
  const rates = RATE_CARDS[city];

  console.log(`City: ${city} | Distance: ${miles.toFixed(2)} miles | ${minutes.toFixed(0)} min | Surge: ${surge.toFixed(2)}x`);

  const uberXFare    = calculateFare(rates.uberX,   miles, minutes, surge);
  const comfortFare  = calculateFare(rates.comfort,  miles, minutes, surge);
  const uberXLFare   = calculateFare(rates.uberXL,  miles, minutes, surge);

  return {
    source: 'formula',
    city,
    distanceMiles: +miles.toFixed(2),
    surgeMultiplier: +surge.toFixed(2),
    rides: [
      { name: 'UberX',   low: uberXFare.low,   high: uberXFare.high,   eta: estimateETA('uberX') },
      { name: 'Comfort', low: comfortFare.low,  high: comfortFare.high, eta: estimateETA('comfort') },
      { name: 'UberXL',  low: uberXLFare.low,   high: uberXLFare.high,  eta: estimateETA('uberXL') },
    ]
  };
}

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────
app.get('/estimates', (req, res) => {
  const { start_lat, start_lng, end_lat, end_lng } = req.query;
  if (!start_lat || !start_lng || !end_lat || !end_lng) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }
  const result = estimatePrices(
    parseFloat(start_lat), parseFloat(start_lng),
    parseFloat(end_lat),   parseFloat(end_lng)
  );
  res.json(result);
});

app.post('/heatmap', (req, res) => {
  const { pickups, end_lat, end_lng } = req.body;
  if (!pickups || !end_lat || !end_lng) {
    return res.status(400).json({ error: 'Missing data' });
  }

  const points = pickups.map(pickup => {
    const result = estimatePrices(pickup.lat, pickup.lng, parseFloat(end_lat), parseFloat(end_lng));
    const cheapest = result.rides.reduce((min, r) => r.low < min.low ? r : min, result.rides[0]);
    return {
      lat: pickup.lat,
      lng: pickup.lng,
      price: cheapest.low,
      rides: result.rides,
    };
  });

  res.json({ points });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ RideSpot backend running on port ${PORT}`);
});
