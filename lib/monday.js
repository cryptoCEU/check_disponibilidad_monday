/**
 * monday.js — Monday.com GraphQL helpers
 * Column IDs are taken from your board schema.
 */

const MONDAY_API_URL = 'https://api.monday.com/v2';

// Column IDs from your board
const COLUMNS = {
  visitDateTime: 'date_mks930kf',  // "Fecha y hora visita"
  leadStatus:    'lead_status',     // "Estado Lead"
  name:          'name',
};

async function queryMondayVisits(targetDate) {
  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  if (!token)   throw new Error('MONDAY_API_TOKEN env var is missing');
  if (!boardId) throw new Error('MONDAY_BOARD_ID env var is missing');

  const dayStr = toMadridDateString(targetDate);

  // Inline all dynamic values — avoids GraphQL variable type conflicts with Monday API
  const query = `
    query GetVisitsByDate {
      boards(ids: [${boardId}]) {
        items_page(
          limit: 500
          query_params: {
            rules: [{
              column_id: "${COLUMNS.visitDateTime}"
              compare_value: ["${dayStr}"]
              operator: contains_text
            }]
          }
        ) {
          items {
            id
            name
            column_values(ids: ["${COLUMNS.visitDateTime}", "${COLUMNS.leadStatus}"]) {
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
    const visitCol  = item.column_values.find((c) => c.id === COLUMNS.visitDateTime);
    const statusCol = item.column_values.find((c) => c.id === COLUMNS.leadStatus);

    return {
      id:             item.id,
      name:           item.name,
      visit_datetime: visitCol?.text  ?? null,
      visit_value:    visitCol?.value ?? null,
      lead_status:    statusCol?.text ?? null,
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

module.exports = { queryMondayVisits, parseColumnDate, toMadridDateString };
