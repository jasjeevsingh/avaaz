# Avaaz

A debate-skills trainer built for the Miri Piri Leaders Retreat. Students learn to build an argument as **Claim → Link → Impact**, practise on a bank of motions, generate debates from a fictional universe they love, and spar out loud with a live AI debate avatar.

## Run it locally

```bash
npm install
npm run dev
```

The app is gated: set `APP_PASSWORD` in `.env.local` (see `.env.example` for every variable). Voice features need `DEEPGRAM_API_KEY`; coaching needs `ANTHROPIC_API_KEY` (with `OPENAI_API_KEY` as a fallback).

## Test

```bash
npm test
```

## Deploy

Every push to `main` builds a production deployment on Vercel.
