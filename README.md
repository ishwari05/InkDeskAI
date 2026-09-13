# Studio Bot — MVP

An AI booking/consultation assistant for tattoo studios. Handles first-contact
WhatsApp triage (placement → size → style → quote → slot request) so leads
don't go cold waiting for a human reply, and hands off to a real person once
a booking is ready to confirm.

This MVP runs fully locally with SQLite so you can demo and iterate on the
conversation logic before wiring up real WhatsApp/Supabase/Razorpay accounts.

## What's actually built

- **Conversation state machine** (`lib/stateMachine.ts`) — the core flow:
  greeting → placement → size → style → deterministic quote → slot request →
  handoff to a human.
- **Deterministic pricing engine** (`lib/pricing.ts`) — price is calculated
  from a studio-configurable table (size × placement × style multipliers),
  *not* guessed by the LLM. The LLM only presents the number naturally.
- **Claude integration** (`lib/claude.ts`) — extracts structured fields
  (placement/size/style) from free-form client text, and writes the
  natural-language reply.
- **SQLite dev database** (`lib/db.ts`) — leads, conversations, messages,
  bookings. Seeded with one demo studio ("Ink & Iron Tattoo Co.") and its
  pricing config on first run.
- **Simulated WhatsApp chat** (`/` — home page) — talk to the bot in a chat
  UI without needing a real WhatsApp Business number yet.
- **Owner dashboard** (`/dashboard`) — see every lead the bot has captured,
  with quoted price range and status.
- **Real webhook endpoint** (`app/api/webhook/whatsapp/route.ts`) — shaped
  for a provider like Interakt/Wati; swap in the actual "send message" API
  call once you pick a provider.
- **Production schema** (`supabase/schema.sql`) — same shape as the SQLite
  dev schema, ready to run in Supabase when you outgrow local dev.

## Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local and add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000 — that's the simulated chat. Open
http://localhost:3000/dashboard in another tab to watch leads land as you chat.

The SQLite file is created automatically at `data/studio.db` on first run,
seeded with one demo studio and pricing config.

## Try this conversation in the simulator

1. "hi, I want a tattoo"
2. "on my forearm"
3. "medium size"
4. "fine line, something botanical"
5. (bot gives a quote and asks about a slot) → "yes, this weekend works"
6. Check the Dashboard tab — the lead now shows placement, size, style,
   quote range, and status `booking_requested`.

## What's deliberately NOT built yet (by design, for MVP scope)

- **Real WhatsApp connection** — needs a Meta Business verification +
  a provider account (Interakt/Wati/Gupshup). The webhook endpoint is
  shaped and ready; you just need to point the provider at it and fill in
  the "send message" call (marked with a `TODO` in the webhook route).
- **Real payments** — Razorpay deposit-link generation isn't wired in yet;
  `calculateDeposit()` computes the amount, but triggering an actual payment
  link is a next step.
- **Multi-studio onboarding UI** — right now there's one seeded studio.
  Adding a "create studio + set your pricing" flow is the next feature once
  you have a second pilot studio.
- **Google Calendar sync** — slot booking currently just hands off to a
  human rather than checking real artist availability.
- **Image understanding** — if a client sends a reference photo, the current
  flow just logs it as text context; wiring up Claude's vision input for
  actual image analysis is a small addition to `lib/claude.ts`.

## Editing pricing for the demo studio

Pricing lives in `lib/db.ts` in the seed block (search for `pricing_configs`).
Change the multipliers, base rate, or minimum price there and delete
`data/studio.db` to reseed, or update the row directly with a SQLite client.

## Before real production deployment

This MVP pins Next.js 14.2.32. Next.js 14.x no longer receives security
patches upstream as of mid-2026 — the known CVEs in that line involve
Server Actions and dynamic rewrites, neither of which this app uses (it's
plain API routes only), so it's safe for local dev and demos. Before a real
public deployment, upgrade to a patched Next 15.x/16.x release and re-test.

## Moving to production

1. Run `supabase/schema.sql` in a new Supabase project.
2. Swap the `better-sqlite3` calls in `lib/db.ts` for `@supabase/supabase-js`
   calls (same table/column names, so this is a mostly mechanical rewrite).
3. Sign up with Interakt or Wati, get WhatsApp Business API access, and
   point their webhook at `/api/webhook/whatsapp`.
4. Fill in the Razorpay deposit-link call where `calculateDeposit()` is used.
5. Deploy the Next.js app (Vercel is the path of least resistance).
