# Brand Gap Agent — Deploy Guide

One input → full brand strategy. Validated with real YouTube transcripts and Google Trends data. Outputs a downloadable branded PPT report.

---

## What This Is

You type one word ("fitness", "golf", "skincare").  
The agent finds an unbranded sub-category, validates it with real data, builds a complete brand, and downloads a 8-slide PPT you can share with anyone.

**The thesis:** Nike owns *sports socks*. Nobody owns *Pilates socks*. Same market. Billions in spend. Zero brand ownership in the sub-category. That gap is where $3M brands get built in 30 days.

---

## Deploy to Vercel in 5 Minutes

### Step 1 — Clone and install

```bash
git clone <your-repo>
cd brand-gap-agent
npm install
```

### Step 2 — Get your API keys

**Anthropic (required)**
1. Go to https://console.anthropic.com
2. API Keys → Create Key
3. Copy it

**YouTube Data API v3 (recommended — enables real transcripts)**
1. Go to https://console.cloud.google.com
2. Create a project (or use existing)
3. APIs & Services → Enable APIs → search "YouTube Data API v3" → Enable
4. APIs & Services → Credentials → Create Credentials → API Key
5. Copy it (free tier: 10,000 units/day, each agent run costs ~200 units)

**SerpApi (recommended — enables real Google Trends)**
1. Go to https://serpapi.com
2. Sign up → Dashboard → API Key
3. Copy it (free tier: 100 searches/month, each run uses 2)

### Step 3 — Set environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in your keys. For local dev only — never commit `.env.local`.

### Step 4 — Test locally

```bash
npm run dev
```

Open http://localhost:5173. The app runs but API calls go to Vercel functions which aren't running locally yet. To test the full flow locally:

```bash
npm install -g vercel
vercel dev
```

This runs both the React app AND the serverless functions at http://localhost:3000.

### Step 5 — Deploy to Vercel

```bash
vercel
```

Follow the prompts. When asked about settings, defaults are fine.

Then add your environment variables in the Vercel dashboard:
- Project → Settings → Environment Variables
- Add: `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `SERPAPI_KEY`
- Redeploy: `vercel --prod`

That's it. Your agent is live.

---

## Project Structure

```
brand-gap-agent/
├── api/
│   ├── claude.js       # Anthropic proxy — keeps API key server-side
│   ├── youtube.js      # YouTube search + transcript extraction
│   └── trends.js       # Google Trends via SerpApi
├── src/
│   ├── App.jsx         # Main React app (11 stages, PPT export)
│   └── main.jsx        # Entry point
├── index.html
├── vite.config.js
├── vercel.json         # Routes + function config
├── package.json
└── .env.example        # Copy to .env.local
```

---

## How the Real Data Works

### YouTube Pipeline
```
User types "fitness"
    ↓
Stage 1 (Claude): finds "reformer pilates grip socks" + search term
    ↓
Stage 2 (YouTube API): searches "reformer pilates grip socks tutorial"
    → gets 12 video IDs from micro-influencers
    → fetches transcripts from YouTube's caption endpoint
    → returns real transcript corpus (up to 25,000 chars)
    ↓
Stage 4 (Claude): reads REAL transcripts
    → finds actual sentences where people say "those grippy socks"
    → counts real mentions, detects zero brand language
    → outputs verified gap signal
```

### Google Trends Pipeline
```
Stage 3 (SerpApi): fetches 12 months of trend data for "pilates grip socks"
    → returns timeline values (0-100 scale)
    → returns rising + top related queries
    ↓
Scoring algorithm:
    - Momentum = (recent 4 weeks avg - older 4 weeks avg) / older avg × 100
    - Direction = SHARPLY RISING / STEADILY RISING / FLAT / DECLINING
    - Opportunity score = 0-10 (rising but not yet at peak = 9/10)
    ↓
Stage 5 (Claude): reads real trend data
    → places product on diffusion curve
    → generates timing verdict (PERFECT TIMING / GOOD TIMING / etc.)
    → gives window of opportunity estimate
```

### Graceful Degradation
If API keys aren't set, the agent doesn't break — it simulates those stages with Claude's knowledge. You'll see `~ SIMULATED` badges instead of `✓ REAL DATA` badges. The output is still useful, just less validated.

---

## Selling This

### Path A — SaaS ($49-99/report or $99/month)
- Already built. Add Stripe Checkout before the Run button.
- API costs per run: ~$0.50 Anthropic + ~$0.02 SerpApi = ~$0.52
- At $49/report: 94x margin on variable cost
- Add auth with Clerk or Auth.js (30 min setup)

### Path B — White-label ($500-2000 to agencies)
- Change brand name + colors in App.jsx
- Remove this README, add client-specific docs
- Sell to e-commerce agencies who resell to clients
- They keep API keys, you get a one-time fee

### Path C — Done-for-you reports ($500-1500 each)
- Run it yourself, clean the PPT output, send to client
- 8 minutes of compute, 20 minutes of cleanup
- No additional tech needed

### Adding Stripe (Path A)
```jsx
// Before the Run button in App.jsx:
const handleStart = async () => {
  const session = await fetch('/api/checkout', { method: 'POST' });
  const { url } = await session.json();
  window.location.href = url; // redirect to Stripe
}
// After payment success, Stripe redirects back with ?paid=true
// Check that before allowing run()
```

Add `/api/checkout.js` and `/api/webhook.js` as Vercel functions.
Full Stripe Next.js docs: https://stripe.com/docs/checkout/quickstart

---

## Costs (Per Agent Run)

| Service | Cost | Notes |
|---------|------|-------|
| Anthropic (Claude Sonnet) | ~$0.45 | 9 stages × avg 500 tokens out |
| YouTube Data API | Free | 200 units, 10k/day free tier |
| SerpApi | ~$0.02 | 2 searches, free tier = 100/month |
| Vercel hosting | Free | Hobby tier covers this easily |
| **Total per run** | **~$0.47** | |

At $49/report: **~$48.53 margin per sale.**

---

## Upgrading Further

**Memory across runs** — store past gap scores in Vercel KV (free):
```bash
vercel kv create brand-gap-memory
```
Then in `/api/gaps.js` read/write previous results so the agent avoids re-finding the same opportunities.

**Email delivery** — send the PPT automatically via Resend:
```bash
npm install resend
```
Add `/api/send-report.js` that emails the generated PPT after completion.

**Better transcript extraction** — if YouTube captions are unavailable, fall back to OpenAI Whisper transcription of the audio. More expensive (~$0.006/minute) but gets transcripts for any video.

---

## Local Dev Without Vercel CLI

The API functions need Vercel CLI to run locally. If you just want to test the UI without real API calls:

1. In `src/App.jsx`, temporarily replace `/api/claude` with the direct Anthropic endpoint and add your key
2. Set `ytData = null` and `trendsData = null` to force simulation mode
3. Change back before deploying

---

## Support

File issues at [your repo]. The agent degrades gracefully — if something breaks, check the log panel in the sidebar for error messages.
