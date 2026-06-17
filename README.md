# BistroBot21

BistroBot21 is an intelligent cafe management system built for small to medium-sized cafes. It combines a modern, offline-capable staff point-of-sale (POS) system with a conversational AI assistant (BistroBot21) that operates entirely over WhatsApp for the cafe owner.

## Architecture Overview

BistroBot21 is a monorepo consisting of:
1. **Frontend (Staff POS)**: A React-based Progressive Web App (PWA) built with Vite and TailwindCSS. It features full offline capabilities via IndexedDB, allowing staff to queue orders during network outages.
2. **Backend**: A Node.js/Express server that powers the API, handles Supabase communication, and hosts the AI bot logic.
3. **Database**: Supabase (PostgreSQL) is used for data storage, authentication, and real-time capabilities.
4. **Intelligence Layer**: The backend deeply integrates with the Gemini API to parse natural language messages from the owner (e.g., "Add 5 portions of biryani", "We threw away 2 portions of rice") and generate daily prep predictions based on weather, day of week, and local festivals.

## System Components

- `cafeos/backend/`: Node.js server.
- `cafeos/frontend/`: React PWA.
- `Contextual-Plan/`: Product Requirements Document (PRD), API Specifications, Database Schema, and system design docs.

## Setup & Deployment

For local development instructions, see [cafeos/README.md](cafeos/README.md).

### Quick Start
```bash
# 1. Start the backend
cd cafeos/backend
npm install
npm run dev

# 2. Start the frontend
cd cafeos/frontend
npm install
npm run dev
```

For more detailed setup instructions, including database migrations and environment variables, please refer to the detailed guides in the `cafeos/` directory.