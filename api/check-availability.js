const MONDAY_API_URL = "https://api.monday.com/v2";
const COL_DATETIME   = "date_mks930kf";  // "Fecha y hora visita"

const pad = (n) => String(n).padStart(2, "0");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Usa GET o POST" });

  // Auth guard
  const apiKey = process.env.WEBHOOK_API_KEY;
  if (apiKey) {
    const provided = req.headers["authorization"]?.replace("Bearer ", "").trim();
    if (provided !== apiKey)
      return res.status(401).json({ error: "Unauthorized" });
  }

  const params = req.method === "GET" ? req.query : req.body;
  const { datetime, start } = params;
  const input = datetime || start;

  if (!input)
    return res.status(400).json({ error: "Proporciona 'datetime' en formato ISO 8601. Ej: 2026-03-10T17:00:00" });

  const dt = new Date(input);
  if (isNaN(dt.getTime()))
    return res.status(400).json({ error: "Fecha inválida. Usa ISO 8601." });

  const dateStr     = dt.toISOString().split("T")[0];
  const timeStr     = `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`;
  const timeDisplay = timeStr.slice(0, 5);

  const token   = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  if (!token)   return res.status(500).json({ error: "MONDAY_API_TOKEN no configurado" });
  if (!boardId) return res.status(500).json({ error: "MONDAY_BOARD_ID no configurado" });

  try {
    const r = await fetch(MONDAY_API_URL, {
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
    });

    const json = await r.json();

    if (json.errors?.length)
      return res.status(502).json({ error: "Monday API error", detail: json.errors });

    const items = json?.data?.boards?.[0]?.items_page?.items || [];

    const conflicts = items.filter((item) => {
      const dtCol = item.column_values.find((c) => c.id === COL_DATETIME);

      let itemDate = "", itemTime = "";
      try {
        const v = JSON.parse(dtCol?.value || "{}");
        itemDate = v.date || "";
        itemTime = v.time || "";
      } catch {
        const parts = (dtCol?.text || "").split(" ");
        itemDate = parts[0] || "";
        itemTime = parts[1] ? `${parts[1]}:00` : "";
      }

      return itemDate === dateStr && itemTime === timeStr;
    });

    const available = conflicts.length === 0;

    return res.status(200).json({
      available,
      date: dateStr,
      time: timeDisplay,
      requested_datetime: dt.toISOString(),
      conflicts_found: conflicts.length,
      slots_taken: conflicts.map((i) => ({
        id: i.id,
        name: i.name,
      })),
      message: available
        ? `El ${dateStr} a las ${timeDisplay} está disponible.`
        : `El ${dateStr} a las ${timeDisplay} NO está disponible (${conflicts.length} reserva/s existente/s).`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
