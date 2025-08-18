# Cognito – Milestones, Status, and Next Steps

Last updated: 2025-08-18

## Overview

This document captures what’s been built so far and a pragmatic roadmap to resume quickly after a pause. The app blends a chat experience with a Learning Coach powered by Supabase (Postgres + pgvector) and Google Generative AI.

## What’s done ✅

1. Baseline UI restored

- Returned the app to the original chat UI and kept it as the stable baseline.
- Removed prior refactor artifacts and prevented global CSS bleed.

2. Database and schema (Supabase)

- Tables created: `profiles`, `goals`, `decks`, `cards` (with `embedding vector(768)`), `reviews`, `conversations`, `messages`.
- RLS enabled with owner-only access using `auth.uid()`.
- pgvector enabled; embeddings stored for cards when API key is set.

3. Server integration

- Express server integrated with Supabase server client (service role) and Google Generative AI.
- Auth: Prefer Supabase JWT from `Authorization: Bearer <token>`; in non‑production, a dev fallback via `x-user-id` is allowed.
- Endpoints:
  - Chat: `/completions`, `/newSession`, `/history`, `/conversation`, `/renameChat`, `/deleteChat`
  - Coach:
    - Goals/Decks/Cards: `POST /coach/goal`, `GET /coach/goals`, `POST /coach/deck`, `GET /coach/decks`, `POST /coach/card`
    - Study queue: `GET /coach/study?deckId=...&limit=...`
    - Submit review: `POST /coach/review`
    - Stats: `GET /coach/stats?deckId=...` (due count, today reviewed, streak)

4. Frontend auth and wiring

- Supabase Auth (magic link) added; session is persisted in the browser.
- `AuthStatus` in the header handles sign-in/out via a compact modal.
- All Coach API calls attach `Authorization` when signed in; dev-only `x-user-id` remains as a fallback off production.

5. CoachPanel UX

- CoachPanel opens in a responsive `react-modal` overlay; no overlap with the chat composer.
- Forms for Goals, Decks, and Cards.
- Scoped form styles using `.coach-*` classes to avoid global CSS conflicts.

6. Study UX v1

- Due queue shown one card at a time: reveal Back after “Show answer,” then choose Again/Hard/Good/Easy.
- Stats area with badges (Due now, Total due, Today, Streak) plus a simple session progress bar.
- Optimistic dequeue after rating; stats update in background.

7. Styling and accessibility

- Replaced broad selectors with scoped classes to prevent bleed into the chat layout.
- Modal sizing made responsive (max-height/width) with scroll for content.

## Known notes / gotchas

- Auth in production requires a valid Supabase JWT on the request (Authorization header). The `x-user-id` header works only in non-production.
- Ensure environment variables are set:
  - Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE` (secret), `API_KEY` (Google Generative AI)
  - Frontend: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, optional `REACT_APP_API_BASE`
- If Goals/Decks/Cards creation fails while signed in, check the browser Network panel:
  - Verify the `Authorization` header is attached.
  - Confirm RLS policies match the inserts (owner-only using `auth.uid()`).
  - Look for 401/403 responses and payload error messages.

## Quick API map (Coach)

- Create goal: `POST /coach/goal` → `{ title, description?, targetDate? }`
- List goals: `GET /coach/goals`
- Create deck: `POST /coach/deck` → `{ title, description? }`
- List decks: `GET /coach/decks`
- Create card: `POST /coach/card` → `{ deckId, front, back }` (embedding computed if API key supplied)
- Study queue: `GET /coach/study?deckId=...&limit=10`
- Submit review: `POST /coach/review` → `{ cardId, rating }` (0 Again, 2 Hard, 4 Good, 5 Easy)
- Deck stats: `GET /coach/stats?deckId=...` → `{ dueCount, todayReviewed, streakDays }`

## Where we left off

- Auth, RLS, and Coach endpoints are working end-to-end.
- CoachPanel has a clean modal UI with single-card study flow and stats.
- CSS is scoped; forms and modals don’t interfere with the chat UI.

## Next steps (when you’re back) ▶️

High priority

- Study UX v2
  - Keyboard shortcuts (1=Again, 2=Hard, 3=Good, 4=Easy; Space=Show answer)
  - Small animations for progress bar and card reveal; add “Undo last rating”
  - Session controls: target count, shuffle, and finish summary
- Reliability & QA
  - Add unit tests for scheduling math (`computeNextReview`) and API handlers
  - Add minimal e2e smoke (sign-in, create deck/card, review one card)

Medium priority

- Embedding search & retrieval
  - Endpoint: `/coach/search?q=&deckId=`; rank by cosine similarity on pgvector
  - UI: search bar in CoachPanel; show top matches and “add to study” links
- Chat UX enhancements
  - Streaming responses; show citations/links to related cards
  - “Create card from message” button (front/back prefilled from selection)

Nice-to-have

- Import/Export
  - CSV/Markdown import/export for decks and cards
  - Per-user backup/restore (Supabase bucket or downloadable file)
- Polish
  - Header styles; modal padding/spacing passes (tiny tweaks)
  - Dark/light scheme refinements for badges and buttons

## Quick start (local)

- Set server env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `API_KEY`
- Set frontend env: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`
- Start frontend and backend per your usual workflow (server serves the built app; CRA dev server can proxy to `localhost:8000`).

## Troubleshooting checklist

- 401/403 on Coach endpoints → confirm Authorization header; verify RLS owner policies
- Card creation stuck → ensure a deck is selected and both Front/Back provided
- No due cards → add cards or check that `reviews.due_date` logic uses local time correctly for your region
- Embeddings missing → confirm `API_KEY` is set; server logs will warn if embedding fails

---

This doc is the source of truth for the current state and roadmap. When you resume, start with “Study UX v2” and test one complete loop: sign in → create deck/card → study → verify stats and streak.
