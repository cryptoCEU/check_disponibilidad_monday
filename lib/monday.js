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

/**
 * Query Monday.com for all items that have a visit scheduled
 * on the same calendar day as `targetDate`.
 * We fetch the whole day and do fine-grained time filtering in JS,
 * because Monday's column-value filter for dates doesn't support time ranges.
 */
async function queryMondayVisits(targetDate) {
  const token  = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  if (!token)   throw new Error('MONDAY_API_TOKEN env var is missing');
  if (!boardId) throw new Error('MONDAY_BOARD_ID env var is missing');

  // Format date as YYYY-MM-DD (Madrid timezone) for Monday filter
  const dayStr = toMadridDateString(targetDate);

  const query = /* graphql */ `
    query GetVisitsByDate($boardId: ID!, $columnId: String!, $dateValue: String!) {
      boards(ids: [$boardId]) {
        items_page(
          limit: 500
          query_params: {
            rules: [{
              column_id: $columnId
              compare_value: [$dateValue]
              operator: contains_text
            }]
          }
        ) {
          cursor
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

  const variables = {
    boardId: String(boardId),
    columnId: COLUMNS.visitDateTime,
    dateValue: dayStr,
  };

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
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
      visit_datetime: visitCol?.text   ?? null,   // human text from Monday
      visit_value:    visitCol?.value  ?? null,   // raw JSON value
      lead_status:    statusCol?.text  ?? null,
    };
  });
}

/**
 * Parse the raw value from Monday's date column (with time).
 * Monday stores it as JSON: {"date":"2025-03-15","time":"10:00:00","changed_at":"..."}
 * or as plain text "2025-03-15 10:00:00"
 */
function parseColumnDate(rawValue) {
  if (!rawValue) return null;

  // Try JSON value field first
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.date) {
      const timeStr = parsed.time || '00:00:00';
      // Monday stores times in UTC internally
      const iso = `${parsed.date}T${timeStr}Z`;
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch (_) {
    // not JSON — fall through
  }

  // Try plain text "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD"
  const cleaned = rawValue.replace(' ', 'T');
  const d = new Date(cleaned.includes('T') ? cleaned : `${cleaned}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a JS Date to "YYYY-MM-DD" in Europe/Madrid timezone.
 */
function toMadridDateString(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }); // en-CA gives YYYY-MM-DD
}

module.exports = { queryMondayVisits, parseColumnDate, toMadridDateString };
