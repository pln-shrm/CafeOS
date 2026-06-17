# BistroBot21

BistroBot21 is a WhatsApp-first cafe management system built for a small owner-operated cafe in Goa, India. It combines a WhatsApp bot (owner-facing) for vendor orders, prep predictions, and daily check-ins with a React PWA (staff + owner) for order taking, billing, and menu management — all backed by a shared Node.js/Express + Supabase backend.

## Running locally

**Backend**
```bash
cd backend
cp .env.example .env   # fill in your secrets
npm install
npm run dev            # starts on http://localhost:3000
```

**Frontend**
```bash
cd frontend
cp .env.example .env   # fill in your secrets
npm install
npm run dev            # starts on http://localhost:5173
```

## Environment variables

- Backend: [`backend/.env.example`](backend/.env.example)
- Frontend: [`frontend/.env.example`](frontend/.env.example)
