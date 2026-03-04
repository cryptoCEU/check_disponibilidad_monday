# Monday Availability Webhook

API serverless que consulta tu tablero de **Monday.com** para comprobar si un horario de visita está disponible. Diseñado para integrarse con **ElevenLabs** durante conversaciones con clientes.

---

## 📐 Arquitectura

```
ElevenLabs (AI Voice) ──POST──▶ Vercel Serverless ──GraphQL──▶ Monday.com API
                                        │
                                 { available: true/false,
                                   message: "..." }
```

---

## 🔧 Variables de entorno

Copia `.env.example` a `.env` y rellena los valores:

| Variable | Descripción | Obligatoria |
|---|---|---|
| `MONDAY_API_TOKEN` | Token API v2 de Monday.com | ✅ |
| `MONDAY_BOARD_ID` | ID numérico del tablero de leads | ✅ |
| `SLOT_BUFFER_MINUTES` | Minutos de margen entre visitas (default: `60`) | ❌ |
| `WEBHOOK_API_KEY` | Clave secreta para `Authorization: Bearer` | ❌ |

### Cómo obtener tu `MONDAY_API_TOKEN`
1. Monday.com → avatar (abajo izquierda) → **Developers**
2. **My Access Tokens** → copia el token

### Cómo obtener tu `MONDAY_BOARD_ID`
Abre el tablero en Monday. La URL tiene la forma:
```
https://your-org.monday.com/boards/XXXXXXXXXX
```
El número es el ID.

---

## 🚀 Despliegue en Vercel

### Opción A — Vercel CLI (recomendado)

```bash
# 1. Instala Vercel CLI si no lo tienes
npm i -g vercel

# 2. Conecta con tu cuenta
vercel login

# 3. Despliega (primera vez)
vercel

# 4. Añade las variables de entorno
vercel env add MONDAY_API_TOKEN
vercel env add MONDAY_BOARD_ID
vercel env add SLOT_BUFFER_MINUTES   # opcional, default 60
vercel env add WEBHOOK_API_KEY       # opcional

# 5. Re-despliega con las variables
vercel --prod
```

### Opción B — GitHub + Vercel dashboard

1. Sube este repo a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New Project** → importa el repo.
3. En **Environment Variables** añade las variables de la tabla de arriba.
4. Pulsa **Deploy**.

---

## 🧪 Pruebas locales

```bash
# 1. Instala dependencias de desarrollo
npm install --save-dev dotenv

# 2. Crea tu .env con las credenciales reales
cp .env.example .env
# edita .env con tu editor favorito

# 3. Lanza las pruebas
node scripts/test-local.js

# 4. O usa Vercel Dev para simular el entorno completo
npx vercel dev
```

---

## 📬 API Reference

### `POST /api/check-availability`

#### Headers

| Header | Valor |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <WEBHOOK_API_KEY>` (si está configurado) |

#### Request body

```json
{
  "datetime": "2025-04-10T10:00:00Z"
}
```

> La fecha y hora **debe estar en formato ISO 8601**.  
> Para la zona horaria de Madrid usa `+02:00` (verano) o `+01:00` (invierno), o envía en UTC (`Z`) y el sistema convertirá automáticamente.

#### Response — slot disponible

```json
{
  "available": true,
  "requested_datetime": "2025-04-10T10:00:00.000Z",
  "slot_buffer_minutes": 60,
  "conflicts_found": 0,
  "slots_taken": [],
  "message": "El horario del jueves, 10 de abril de 2025 a las 12:00 está disponible."
}
```

#### Response — slot ocupado

```json
{
  "available": false,
  "requested_datetime": "2025-04-10T10:30:00.000Z",
  "slot_buffer_minutes": 60,
  "conflicts_found": 1,
  "slots_taken": [
    {
      "id": "1234567890",
      "name": "Juan García",
      "visit_datetime": "2025-04-10 10:00",
      "status": "Visita agendada"
    }
  ],
  "message": "El horario del jueves, 10 de abril de 2025 a las 12:30 NO está disponible. Hay 1 visita(s) en esa franja: 2025-04-10 10:00. Por favor, proponga otro horario."
}
```

#### Códigos de respuesta

| Código | Significado |
|---|---|
| `200` | Consulta correcta (ver `available`) |
| `400` | Body inválido o fecha con formato incorrecto |
| `401` | API key incorrecta |
| `405` | Método no permitido (solo POST) |
| `502` | Error al conectar con Monday.com |

---

## 🤖 Integración con ElevenLabs

En tu agente de ElevenLabs, configura un **tool / function call** con estos parámetros:

```json
{
  "name": "check_visit_availability",
  "description": "Comprueba si una fecha y hora de visita está disponible en el sistema de gestión de leads.",
  "parameters": {
    "type": "object",
    "properties": {
      "datetime": {
        "type": "string",
        "description": "Fecha y hora de la visita solicitada en formato ISO 8601 (e.g. 2025-04-10T10:00:00Z)"
      }
    },
    "required": ["datetime"]
  },
  "url": "https://your-project.vercel.app/api/check-availability",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer your_secret_key_here"
  }
}
```

El agente usará el campo `message` de la respuesta para comunicarse con el cliente: si `available` es `false`, propondrá automáticamente otro horario.

---

## 🧩 Postman

Importa `postman_collection.json` en Postman:

1. **Import** → selecciona el archivo.
2. Edita las variables de colección:
   - `baseUrl` → tu URL de Vercel (o `http://localhost:3000` en local)
   - `apiKey` → tu `WEBHOOK_API_KEY`
3. Ejecuta los 5 tests incluidos.

---

## 📁 Estructura del proyecto

```
├── api/
│   └── check-availability.js   # Endpoint principal (Vercel serverless)
├── lib/
│   └── monday.js               # Cliente GraphQL de Monday.com
├── scripts/
│   └── test-local.js           # Tests rápidos sin servidor
├── postman_collection.json     # Colección lista para importar
├── vercel.json                 # Configuración de Vercel
├── .env.example                # Plantilla de variables de entorno
└── package.json
```
