# PasteTrace

PasteTrace is an integrated troubleshooting console that turns a board inspection image into an explainable root-cause diagnosis, a step-by-step fix plan, and an exportable 8D report, learning from every case it closes.

## Run

```bash
npm install
npm run dev                 # web app: http://localhost:5173

python server/start.py      # local API: http://localhost:8000 (optional)
```

Open http://localhost:5173. Without the server, vision falls back on-device and the chat falls back to offline replies. For the AI chat, copy `.env.example` to `.env` and add a Gemini API key.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app (http://localhost:5173) |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm test` | Engine and vision sanity checks |
| `npm run eval` | Rule-engine + NLU eval harness |
| `python server/start.py` | Start the local API (http://localhost:8000) |

More: `PRODUCT.md` for what it does, `DESIGN.md` for the design system.
