const MONDAY_API_URL = "https://api.monday.com/v2";
const COL_DATETIME   = "date_mks930kf";  // "Fecha y hora visita" (tablero de leads)

const { getBlockedRanges } = require("../lib/monday");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Usa GET o POST" });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const apiKey = process.env.WEBHOOK_API_KEY;
  if (apiKey) {
    const provided = req.headers["authorization"]?.replace("Bearer ", "").trim();
    if (provided !== apiKey)
      return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Validación del input ──────────────────────────────────────────────────
  const params = req.method === "GET" ? req.query : req.body;
  const { datetime, start } = params;
  const input = (datetime || start || "").trim();

  if (!input)
    return res.status(400).json({
      error: "Proporciona 'datetime' en formato ISO 8601. Ej: 2026-03-10T10:00:00",
    });

  const match = input.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match)
    return res.status(400).json({
      error: "Fecha inválida. Usa ISO 8601. Ej: 2026-03-10T10:00:00",
    });

  const dateStr    = match[1];          // "2026-03-10"
  const timeStr    = match[2];          // "10:00"
  const targetText = `${dateStr} ${timeStr}`;  // formato Monday: "2026-03-10 10:00"

  // ── Credenciales ──────────────────────────────────────────────────────────
  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token)   return res.status(500).json({ error: "MONDAY_API_TOKEN no configurado" });
  if (!boardId) return res.status(500).json({ error: "MONDAY_BOARD_ID no configurado" });

  try {
    // ── Consultas en paralelo: leads + bloqueos ────────────────────────────
    const [leadsData, blockedItems] = await Promise.all([

      // CHECK 1 — tablero de leads (lógica original sin cambios)
      fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "API-Version": "2024-01",
        },
        body: JSON.stringify({
          query: `
            query ($boardId: ID!) {
              boards(ids: [$boardId]) {
                items_page(limit: 500) {
                  items {
                    id
                    name
                    column_values(ids: ["${COL_DATETIME}"]) {
                      id text value
                    }
                  }
                }
              }
            }
          `,
          variables: { boardId },
        }),
      }).then((r) => r.json()),

      // CHECK 2 — tablero de bloqueos de agenda (NUEVO)
      getBlockedRanges(targetText),
    ]);

    // ── Errores de Monday en el tablero de leads ──────────────────────────
    if (leadsData.errors?.length)
      return res.status(502).json({ error: "Monday API error", detail: leadsData.errors });

    // ── Conflictos en el tablero de leads ─────────────────────────────────
    const items = leadsData?.data?.boards?.[0]?.items_page?.items || [];
    const conflicts = items.filter((item) => {
      const dtCol = item.column_values.find((c) => c.id === COL_DATETIME);
      return (dtCol?.text || "") === targetText;
    });

    // ── Respuesta: bloqueado por agenda (prioridad alta) ──────────────────
    if (blockedItems.length > 0) {
      const b = blockedItems[0];
      return res.status(200).json({
        available:         false,
        date:              dateStr,
        time:              timeStr,
        comparing_against: targetText,
        conflicts_found:   blockedItems.length,
        slots_taken:       [],
        blocked_by_agenda: blockedItems,
        message: `El ${dateStr} a las ${timeStr} NO está disponible: agenda bloqueada (${b.inicio} – ${b.fin})${b.comentario ? ` — ${b.comentario}` : ""}. Por favor, proponga otro horario.`,
      });
    }

    // ── Respuesta: disponible o visita conflictiva en leads ───────────────
    const available = conflicts.length === 0;
    return res.status(200).json({
      available,
      date:              dateStr,
      time:              timeStr,
      comparing_against: targetText,
      conflicts_found:   conflicts.length,
      slots_taken:       conflicts.map((i) => ({ id: i.id, name: i.name })),
      blocked_by_agenda: [],
      message: available
        ? `El ${dateStr} a las ${timeStr} está disponible.`
        : `El ${dateStr} a las ${timeStr} NO está disponible (${conflicts.length} reserva/s existente/s).`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
