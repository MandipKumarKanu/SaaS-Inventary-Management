# SaaS-Inventary-Management

General multi-workspace inventory management SaaS — products, warehouses, stock ledger, purchasing, sales, transfers, returns, cycle counts, billing, and analytics.

## Layout

- `backend/` — Node.js + Express + TypeScript REST API (`/api/v1`), Supabase PostgreSQL, Zod validation, Stripe billing.
- `frontend/` — React 19 + Vite + React Router + Zustand + axios + Recharts + Radix UI.

## Quick start

```bash
# Backend
cd backend
cp .env.example .env   # fill in Supabase + Stripe values (never commit .env)
npm install
npm run migrate
npm run dev            # tsx watch src/app.ts

# Frontend
cd frontend
cp .env.example .env   # set VITE_SITE_URL / API URL
npm install            # or: bun install
npm run dev            # vite
```

## Useful commands

| Where     | Command            | Purpose                  |
|-----------|--------------------|--------------------------|
| backend   | `npm test`         | vitest suite             |
| backend   | `npm run build`    | tsc → `dist/`            |
| backend   | `npm run migrate`  | run SQL migrations       |
| backend   | `npm run seed`     | seed demo data           |
| frontend  | `npm run build`    | vite production build    |
| frontend  | `npm run lint`     | oxlint                   |
| frontend  | `npm run preview`  | preview production build |

## Notes

- One user account can belong to multiple workspaces; every workspace-owned record carries `workspace_id`.
- All stock movements go through a single transactional inventory engine and append to an immutable ledger.
- API errors use the `{ success: false, error: { code, message } }` envelope.
