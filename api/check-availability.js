const MONDAY_API_URL    = "https://api.monday.com/v2";
const COL_VISIT_START   = "date_mks930kf";  // "Fecha y hora inicio visita"
const COL_VISIT_END     = "date_mm38scf6";  // "Fecha y hora fin visita"

const { getBlockedRanges, addMinutesToTextDate } = require("../lib/monday");

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

  const dateStr    = match[1];           // "2026-03-10"
  const timeStr    = match[2];           // "10:00"
  const targetText = `${dateStr} ${timeStr}`;  // "2026-03-10 10:00"

  // ── Credenciales ──────────────────────────────────────────────────────────
  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token)   return res.status(500).json({ error: "MONDAY_API_TOKEN no configurado" });
  if (!boardId) return res.status(500).json({ error: "MONDAY_BOARD_ID no configurado" });

  // Buffer en minutos: se usa solo si la visita no tiene hora fin definida
  const bufferMinutes = parseInt(process.env.SLOT_BUFFER_MINUTES || "30", 10);

  try {
    // ── Consultas en paralelo: leads + bloqueos ────────────────────────────
    const [leadsData, blockedItems] = await Promise.all([

      // CHECK 1 — tablero de leads
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
                    column_values(ids: ["${COL_VISIT_START}", "${COL_VISIT_END}"]) {
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

      // CHECK 2 — tablero de bloqueos de agenda
      getBlockedRanges(targetText),
    ]);

    // ── Errores de Monday en tablero de leads ─────────────────────────────
    if (leadsData.errors?.length)
      return res.status(502).json({ error: "Monday API error", detail: leadsData.errors });

    // ── Conflictos en el tablero de leads ─────────────────────────────────
    const items = leadsData?.data?.boards?.[0]?.items_page?.items || [];

    const conflicts = items.filter((item) => {
      const startCol = item.column_values.find((c) => c.id === COL_VISIT_START);
      const endCol   = item.column_values.find((c) => c.id === COL_VISIT_END);

      const inicioText = (startCol?.text || "").trim();
      if (!inicioText) return false;

      const finText = (endCol?.text || "").trim();

      if (finText) {
        // Rango real definido por el comercial: inicio <= solicitado <= fin
        return targetText >= inicioText && targetText <= finText;
      } else {
        // Fallback: inicio <= solicitado < inicio + SLOT_BUFFER_MINUTES
        const finFallback = addMinutesToTextDate(inicioText, bufferMinutes);
        return targetText >= inicioText && targetText < finFallback;
      }
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
      slots_taken:       conflicts.map((i) => {
        const startCol = i.column_values.find((c) => c.id === COL_VISIT_START);
        const endCol   = i.column_values.find((c) => c.id === COL_VISIT_END);
        return {
          id:          i.id,
          name:        i.name,
          visit_start: startCol?.text || "",
          visit_end:   endCol?.text   || "",
        };
      }),
      blocked_by_agenda: [],
      message: available
        ? `El ${dateStr} a las ${timeStr} está disponible.`
        : `El ${dateStr} a las ${timeStr} NO está disponible (${conflicts.length} reserva/s existente/s).`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
