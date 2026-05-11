/**
 * monday.js — Monday.com GraphQL helpers
 * Column IDs are taken from your board schema.
 */
const MONDAY_API_URL = 'https://api.monday.com/v2';

// Column IDs — tablero de leads
const COLUMNS = {
  visitStart:  'date_mks930kf',  // "Fecha y hora inicio visita"
  visitEnd:    'date_mm38scf6',  // "Fecha y hora fin visita"
  leadStatus:  'lead_status',    // "Estado Lead"
  name:        'name',
};

async function queryMondayVisits(targetDate) {
  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token)   throw new Error('MONDAY_API_TOKEN env var is missing');
  if (!boardId) throw new Error('MONDAY_BOARD_ID env var is missing');

  const dayStr = toMadridDateString(targetDate);

  const query = `
    query GetVisitsByDate {
      boards(ids: [${boardId}]) {
        items_page(
          limit: 500
          query_params: {
            rules: [{
              column_id: "${COLUMNS.visitStart}"
              compare_value: ["${dayStr}"]
              operator: contains_text
            }]
          }
        ) {
          items {
            id
            name
            column_values(ids: ["${COLUMNS.visitStart}", "${COLUMNS.visitEnd}", "${COLUMNS.leadStatus}"]) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Monday API HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`Monday API GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const items = json?.data?.boards?.[0]?.items_page?.items ?? [];

  return items.map((item) => {
    const startCol  = item.column_values.find((c) => c.id === COLUMNS.visitStart);
    const endCol    = item.column_values.find((c) => c.id === COLUMNS.visitEnd);
    const statusCol = item.column_values.find((c) => c.id === COLUMNS.leadStatus);
    return {
      id:           item.id,
      name:         item.name,
      visit_start:  startCol?.text  ?? null,
      visit_end:    endCol?.text    ?? null,
      visit_value:  startCol?.value ?? null,
      lead_status:  statusCol?.text ?? null,
    };
  });
}

function parseColumnDate(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.date) {
      const timeStr = parsed.time || '00:00:00';
      const iso = `${parsed.date}T${timeStr}Z`;
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch (_) {}
  const cleaned = rawValue.replace(' ', 'T');
  const d = new Date(cleaned.includes('T') ? cleaned : `${cleaned}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function toMadridDateString(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

/**
 * Suma minutos a un texto de fecha en formato Monday "YYYY-MM-DD HH:MM".
 * La aritmética se hace en UTC puro (ambos lados son texto Madrid consistente).
 */
function addMinutesToTextDate(textDate, minutes) {
  const d = new Date(textDate.replace(' ', 'T') + ':00Z');
  d.setTime(d.getTime() + minutes * 60 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablero de bloqueos de agenda (board MONDAY_BLOCKS_BOARD_ID)
// Columns: date4 (Fecha inicio), date_mm12dyk (Fecha fin)
// Lógica: inicioText <= targetText <= finText
// ─────────────────────────────────────────────────────────────────────────────

async function getBlockedRanges(targetText) {
  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BLOCKS_BOARD_ID;

  if (!boardId) return [];

  const query = `
    query GetBlockedRanges {
      boards(ids: [${boardId}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: ["date4", "date_mm12dyk", "long_text_mm143pfd"]) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Monday API HTTP error (blocks): ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`Monday GraphQL error (blocks): ${JSON.stringify(json.errors)}`);
  }

  const items = json?.data?.boards?.[0]?.items_page?.items ?? [];

  return items
    .filter((item) => {
      const inicioCol = item.column_values.find((c) => c.id === 'date4');
      const finCol    = item.column_values.find((c) => c.id === 'date_mm12dyk');

      const inicioText = (inicioCol?.text || '').trim();
      const finText    = (finCol?.text    || '').trim();

      if (!inicioText || !finText) return false;

      return targetText >= inicioText && targetText <= finText;
    })
    .map((item) => ({
      id:         item.id,
      name:       item.name,
      inicio:     item.column_values.find((c) => c.id === 'date4')?.text             || '',
      fin:        item.column_values.find((c) => c.id === 'date_mm12dyk')?.text      || '',
      comentario: item.column_values.find((c) => c.id === 'long_text_mm143pfd')?.text || '',
    }));
}

module.exports = { queryMondayVisits, parseColumnDate, toMadridDateString, addMinutesToTextDate, getBlockedRanges };
