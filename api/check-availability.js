/**
 * POST /api/check-availability
 * Body: { "datetime": "2025-03-15T10:00:00Z" }  (ISO 8601)
 * Returns: { available: true/false, slots_taken: [...], message: "..." }
 */

const { queryMondayVisits, parseColumnDate } = require('../lib/monday');

// How many minutes around a requested slot count as "occupied"
const SLOT_BUFFER_MINUTES = parseInt(process.env.SLOT_BUFFER_MINUTES || '60', 10);

module.exports = async function handler(req, res) {
  // CORS headers (needed for ElevenLabs & Postman)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // --- Auth guard (optional API key) ---
  const apiKey = process.env.WEBHOOK_API_KEY;
  if (apiKey) {
    const provided = req.headers['authorization']?.replace('Bearer ', '').trim();
    if (provided !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // --- Validate input ---
  const { datetime } = req.body || {};
  if (!datetime) {
    return res.status(400).json({
      error: 'Missing required field: datetime (ISO 8601, e.g. "2025-03-15T10:00:00Z")',
    });
  }

  const requestedDate = new Date(datetime);
  if (isNaN(requestedDate.getTime())) {
    return res.status(400).json({
      error: 'Invalid datetime format. Use ISO 8601 (e.g. "2025-03-15T10:00:00Z")',
    });
  }

  // --- Query Monday.com ---
  let visits;
  try {
    visits = await queryMondayVisits(requestedDate);
  } catch (err) {
    console.error('[monday] Query error:', err.message);
    return res.status(502).json({
      error: 'Failed to query Monday.com',
      detail: err.message,
    });
  }

  // --- Check availability ---
  const conflicts = visits.filter((v) => {
    const visitDate = parseColumnDate(v.visit_datetime);
    if (!visitDate) return false;
    const diffMs = Math.abs(visitDate.getTime() - requestedDate.getTime());
    const diffMin = diffMs / 60000;
    return diffMin < SLOT_BUFFER_MINUTES;
  });

  const available = conflicts.length === 0;

  const slotsTaken = conflicts.map((v) => ({
    id: v.id,
    name: v.name,
    visit_datetime: v.visit_datetime,
    status: v.lead_status,
  }));

  // Build a human-readable message (useful for ElevenLabs)
  let message;
  if (available) {
    message = `El horario del ${formatSpanish(requestedDate)} está disponible.`;
  } else {
    const taken = conflicts.map((v) => v.visit_datetime).join(', ');
    message = `El horario del ${formatSpanish(requestedDate)} NO está disponible. Hay ${conflicts.length} visita(s) en esa franja: ${taken}. Por favor, proponga otro horario.`;
  }

  return res.status(200).json({
    available,
    requested_datetime: requestedDate.toISOString(),
    slot_buffer_minutes: SLOT_BUFFER_MINUTES,
    conflicts_found: conflicts.length,
    slots_taken: slotsTaken,
    message,
  });
};

function formatSpanish(date) {
  return date.toLocaleString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}
