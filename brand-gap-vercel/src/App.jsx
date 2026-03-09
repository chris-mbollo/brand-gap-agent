import { useState, useRef, useCallback, useEffect } from "react";
import HistoryScreen from "./HistoryScreen.jsx";

// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────────
const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@300;400&display=swap');
`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --white:   #ffffff;
    --gray-50: #fafafa;
    --gray-100:#f4f4f5;
    --gray-200:#e4e4e7;
    --gray-300:#d1d5db;
    --gray-400:#9ca3af;
    --gray-500:#6b7280;
    --gray-600:#4b5563;
    --gray-700:#374151;
    --gray-900:#111827;
    --black:   #0a0a0a;
    --accent:  #111827;
    --ink:     #111827;
    --green:   #16a34a;
    --amber:   #d97706;
    --blue:    #2563eb;
    --red:     #dc2626;

    --font-serif: 'Instrument Serif', Georgia, serif;
    --font-sans:  'Geist', -apple-system, sans-serif;
    --font-mono:  'Geist Mono', 'SF Mono', monospace;

    --radius-sm: 6px;
    --radius:    10px;
    --radius-lg: 16px;

    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06);
    --shadow:    0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -1px rgba(0,0,0,0.04);
    --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04);
  }

  html, body, #root {
    height: 100%;
    background: var(--white);
    color: var(--gray-900);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }

  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--gray-200); border-radius: 99px; }

  button { cursor: pointer; font-family: var(--font-sans); border: none; background: none; }
  input  { font-family: var(--font-sans); }

  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes fadeUp  { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes blink   { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  .fadeUp  { animation: fadeUp  0.4s cubic-bezier(0.16,1,0.3,1) forwards; }
  .fadeIn  { animation: fadeIn  0.3s ease forwards; }
  .blink   { animation: blink   1.2s step-end infinite; }
`;

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callClaude(prompt, system, maxTokens = 2000) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: maxTokens,
          system: system || `You are the sharpest brand gap analyst alive. Find sub-categories inside massive markets where consumers spend freely but NO brand owns the space. Like Pilates socks in fitness — product awareness, zero brand ownership. Return ONLY raw valid JSON. No markdown. No backticks.`,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (res.status === 429) { await sleep((attempt + 1) * 15000); continue; }
      if (!res.ok) return { _error: `HTTP ${res.status}` };
      const d = await res.json();
      if (d.error) return { _error: d.error.message || JSON.stringify(d.error) };
      const raw = (d.content || []).map(x => x.text || '').join('').trim();
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      try { return JSON.parse(cleaned); } catch {}
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      if (attempt < 2) { await sleep(2000); continue; }
      return { _error: 'Parse failed' };
    } catch (e) {
      if (attempt < 2) { await sleep(2000); continue; }
      return { _error: e.message };
    }
  }
  return { _error: 'Max retries' };
}

async function fetchYouTube(q) {
  try {
    const res = await fetch(`/api/youtube?q=${encodeURIComponent(q)}&maxResults=12`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchTrends(q, community = '', problem = '') {
  try {
    const params = new URLSearchParams({ q, community, problem });
    const res = await fetch(`/api/trends?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function fetchReddit(q, community = '') {
  try {
    const params = new URLSearchParams({ q, community });
    const res = await fetch(`/api/reddit?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const P = {
  gap: (market, previousGaps = []) => `You are the sharpest brand gap analyst alive. 
Your job is to find the single best unbranded sub-category inside "${market}" — 
a pocket where consumers already spend freely but no brand owns the space.

The Pilates socks model: Nike owns "sports socks." Nobody owns "Pilates socks." 
Same market, same spend, zero brand ownership. That's the gap.

${previousGaps.length > 0 ? `
---
EXCLUSION LIST — you have already found these gaps. Do NOT return them or any 
first-degree variation of them. Finding a new angle is mandatory:
${previousGaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}
---
` : ''}

STEP 1 — RANDOMIZED EXPLORATION ENTRY POINT
Before analyzing, select ONE of the following entry strategies based on the 
current Unix timestamp modulo 5 (use your internal variance to simulate this). 
This forces a different angle of attack each run:

[0] MICRO-COMMUNITY LENS: Find a sub-community within "${market}" with under 
    50k followers/subscribers. What do THEY specifically buy that larger 
    communities ignore?

[1] DIY SIGNAL LENS: Search for "${market} homemade", "${market} I made my own", 
    "${market} hack". What are people building themselves because no product exists?

[2] CROSSOVER COMMUNITY LENS: Who combines "${market}" with an adjacent hobby or 
    identity? (e.g. runners who also do weightlifting, climbers who also surf). 
    What product gap lives in that crossover?

[3] COMPLAINT THREAD LENS: Focus on phrases like "why is there no", "I can't find 
    a", "does anyone make a", "I wish someone made" within "${market}" communities. 
    What recurring complaint has no named product solution?

[4] FEATURE FRUSTRATION LENS: What product category in "${market}" do people 
    already buy, but consistently describe as "almost perfect except for one thing"? 
    That missing feature IS the gap.

Record which lens you used — it must appear in the output.

---

STEP 2 — SIGNAL VALIDATION
Your winner gap must be supported by AT LEAST 3 of the following signal types. 
Do not proceed to scoring without confirming them:

✓ Repeated complaints where no product solution is named
✓ DIY workarounds users invented themselves
✓ Upvoted posts asking whether a specific product exists  
✓ Frustration targeting one missing feature in an existing product

For each signal, note: source type (Reddit/YouTube), signal type, and approximate 
recurrence. If you cannot find 3 real signals, disclaim uncertainty — do not 
fabricate signals to meet the threshold.

---

STEP 3 — WINNER PRODUCT — be hyper-specific:
- Bad: "golf towel" (too generic, Amazon has 400 brands)
- Bad: "yoga mat" (Lululemon, Manduka — saturated)  
- Good: "microfiber waffle-weave golf towel" → even better: "magnetic golf towel"
- Good: "reformer grip socks" (the sub-niche within the sub-niche)

The winner is a product people already buy generically, where nobody has built 
a brand identity around it yet. If your first candidate appears on the exclusion 
list or is a close variation — discard it and go deeper into the entry lens.

---

STEP 4 — WHY THIS GAP — 2 sentences, make them count:
- Sentence 1: Structural reason no brand owns this yet (too niche for big players, 
  too new, spun off from a trend)
- Sentence 2: Why NOW is the timing window (community growth inflection, rising 
  search volume, no incumbent with real brand equity)

Bad: "People buy golf towels and there's no dominant brand."
Good: "The disc golf community has exploded 40% YoY but spawned from a demographic 
that rejects traditional golf branding — no brand has crossed over with 
disc-golf-native identity. Search volume for disc golf accessories is at an 
all-time high while brand saturation remains near zero."

---

STEP 5 — GAP SCORE (1–10) — score on 4 axes, average them:
1. Spend evidence: Do people already buy this? (10 = proven spend, 1 = hypothetical)
2. Brand vacuum: How empty is the brand landscape? (10 = zero recognizable brands, 
   1 = 3+ funded competitors)
3. Community identity: Strong self-identity to attach a brand to? (10 = tribal, 
   1 = generic hobbyists)
4. Timing: Early adopter phase or mainstream? (10 = innovators/early adopters, 
   1 = late majority)

A 9/10: proven spend + zero brands + strong tribe + early timing. 
Don't inflate scores — a 7 is a solid gap.

---

STEP 6 — YOUTUBE SEARCH TERM — this is critical:
Must return community lifestyle videos, NOT product listicles or shopping content.

Rules:
- Reflect how the sub-community talks about their lifestyle, not how a shopper 
  searches for a product
- Should return videos where the product appears incidentally, not as the subject
- Avoid single nouns, brand names, or "best/top/review" framing
- Aim for the title pattern a micro-influencer (5k–100k subs) would use
- NEVER use "routine", "workout", "challenge", "exercise", "tutorial"
- Target: "what I use", "my setup", "my essentials", "get ready with me", 
  "week in my life", "what's in my bag", "honest review", "I tried", 
  "day in my life"

Bad → Good:
- "golf towel" → "what's in my golf bag 2024"
- "yoga mat" → "my morning reformer Pilates essentials"
- "running gear" → "marathon training week in my life"

---

Return ONLY valid JSON — no markdown, no backticks:
{
  "parentMarket": "${market}",
  "explorationLensUsed": "name of lens from Step 1 + one sentence on why it 
                          led to this gap",
  "communitySignals": [
    {"source": "Reddit or YouTube", "signalType": "complaint|DIY|existence-question|feature-gap", "description": "what the signal was", "recurrence": "high|medium|low"},
    {"source": "Reddit or YouTube", "signalType": "complaint|DIY|existence-question|feature-gap", "description": "what the signal was", "recurrence": "high|medium|low"},
    {"source": "Reddit or YouTube", "signalType": "complaint|DIY|existence-question|feature-gap", "description": "what the signal was", "recurrence": "high|medium|low"}
  ],
  "subCommunities": [
    {"name": "specific sub-community name", "growthSignal": "strong", "products": ["specific product"]},
    {"name": "specific sub-community name", "growthSignal": "moderate", "products": ["specific product"]},
    {"name": "specific sub-community name", "growthSignal": "emerging", "products": ["specific product"]}
  ],
  "winnerSubCommunity": "name",
  "winnerProduct": "hyper-specific product — form factor, material, or use-case level",
  "gapScore": 9,
  "gapScoreBreakdown": {"spendEvidence": 9, "brandVacuum": 10, "communityIdentity": 8, "timing": 9},
  "whyThisGap": "Structural reason no brand owns this yet. Why NOW is the timing window.",
  "brandSaturation": "VERY LOW",
  "howPeopleReferToIt": "exact generic phrase with no brand name",
  "dominantBrands": ["none yet"],
  "parentMarketSize": "$XB",
  "cagr": "X%",
  "confidenceLevel": "high|medium|low",
  "confidenceNote": "one sentence — any disclaimers on brand status or signal strength",
  "youtubeSearchTerm": "community lifestyle search term a micro-influencer would use"
}`,
  
  mine: (sub, product, ytData, redditData) => {
  const hasYT = ytData?.corpus && ytData.videosWithTranscripts > 0;
  const hasReddit = redditData?.corpus && redditData.postsFound > 0;
  const corpus = [
    hasYT ? `YOUTUBE TRANSCRIPTS (${ytData.videosWithTranscripts} videos):\n${ytData.corpus.slice(0, 9000)}` : '',
    hasReddit ? `REDDIT DISCUSSIONS (${redditData.postsFound} posts):\n${redditData.corpus.slice(0, 9000)}` : ''
  ].filter(Boolean).join('\n\n---\n\n');
  const dataSource = hasYT && hasReddit ? 'REAL_YOUTUBE+REDDIT' : hasYT ? 'REAL_YOUTUBE' : hasReddit ? 'REAL_REDDIT' : 'SIMULATED';
  return corpus
    ? `You have REAL community data from the "${sub}" community.\n\n${corpus}\n\nAnalyze for "${product}" brand gap signals. Find generic language (no brand names), frustration signals, exact phrases people use.\nReturn ONLY JSON: {"transcriptsAnalyzed":${ytData?.videosWithTranscripts||0},"postsAnalyzed":${redditData?.postsFound||0},"dataSource":"${dataSource}","keyQuotes":["exact real quote 1","exact real quote 2","exact real quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"phrase","mentionCount":8,"brandAwareness":"NONE/LOW","buyingIntent":"HIGH/MED/LOW"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":3,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"one sentence based on real data","earlyAdopterProfile":"describe based on actual data"}`
    : `Analyze the "${sub}" community for "${product}" brand gap signals based on your knowledge.\nReturn ONLY JSON: {"transcriptsAnalyzed":0,"postsAnalyzed":0,"dataSource":"SIMULATED","keyQuotes":["quote 1","quote 2","quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"phrase","mentionCount":8,"brandAwareness":"NONE","buyingIntent":"HIGH"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":2,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"simulated — no data available","earlyAdopterProfile":"description"}`;
},
  
  validate: (product, sub, td) => td?.trend
    ? `Validate "${product}" in "${sub}" using REAL Google Trends data:\nDirection: ${td.trend.direction}\nMomentum: ${td.interpretation?.momentum}\nScore: ${td.trend.score}/10\nAt peak: ${td.trend.atPeak}\nRising queries: ${td.risingQueries?.slice(0,5).map(q=>q.query).join(', ')}\nBrand signals in related: ${td.brandSignalCount}\n\nReturn ONLY JSON: {"product":"${product}","dataSource":"REAL_GOOGLE_TRENDS","diffusionStage":"INNOVATORS/EARLY ADOPTERS/EARLY MAJORITY","trendStatus":"${td.trend.direction}","trendMomentum":"${td.interpretation?.momentum}","googleTrendsScore":${td.trend.score},"brandSaturation":"NONE/VERY LOW/LOW/MEDIUM","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"${td.interpretation?.verdict}","confidence":${td.trend.score},"premiumPricingRoom":"HIGH/MEDIUM/LOW","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"how long before gap closes"}`
    : `Validate "${product}" in "${sub}". Where on Diffusion curve? Want Early Adopters.\nReturn ONLY JSON: {"product":"${product}","dataSource":"SIMULATED","diffusionStage":"EARLY ADOPTERS","trendStatus":"GROWING FAST","trendMomentum":"estimated","brandSaturation":"VERY LOW","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"GOOD TIMING","confidence":7,"premiumPricingRoom":"HIGH","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"12-18 months"}`,

  avatar: (sub, product) => `Map the cultural identity of the "${sub}" person buying "${product}". Not demographics — find the tribe. Their "that girl" equivalent.\nReturn ONLY JSON: {"personaName":"name","age":"XX-XX","coreIdentity":"cultural movement","tribeLabel":"self-label","identityKeywords":["w1","w2","w3","w4","w5","w6"],"youtubeTitlePatterns":["pattern 1","pattern 2","pattern 3"],"aspirationalSelf":"who they're becoming","productRole":"functional or symbolic","painPoint":"exact frustration","buyingLanguage":["phrase1","phrase2","phrase3"],"whatTheyWantToFeel":"core emotion","whatRepelsThem":"brand killer","tribalEssence":"one sentence — cultural DNA"}`,

  brandResearch: (persona, identity, tribe) => `Find 3 non-competitor aspirational brands for: "${persona}" / "${identity}" / "${tribe}". Different product category, same person. Like Glossier for pilates girls.\nReturn ONLY JSON: {"inspirationBrands":[{"brand":"name","category":"sells","whySameAvatar":"why same person","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"ONE word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"}],"extractedColorStory":["dominant","secondary","accent","background"],"photographyBrief":"exact shoot brief","modelDirection":"who to cast","overallAestheticDirection":"2 sentences"}`,

 brand: (product, sub, identity, aesthetic) => `Brand identity for "${product}" targeting the "${sub}" tribe. Their identity: "${identity}". Aesthetic: "${aesthetic}". Glossier naming rule: name = aspirational quality the customer gains, NOT the product. "Grounded" not "Grip Socks". "Form" not "Pilates Wear".

Return ONLY JSON: {"winner":"brand name","winnerLogic":"one sentence why","tagline":"under 6 words — identity not product","brandPromise":"one sentence what customer becomes","colorPalette":{"primary":"#hex","secondary":"#hex","accent":"#hex","bg":"#hex","text":"#hex"},"brandVoice":"3 words","websiteHeroHeadline":"under 6 words","websiteHeroSubline":"one line","ctaText":"button text","nameOptions":[{"name":"n1","aspirationalQuality":"what it delivers"},{"name":"n2","aspirationalQuality":"what it delivers"},{"name":"n3","aspirationalQuality":"what it delivers"}]}`,

  shopify: (brand, product, sub, avatar) => `Shopify store brief for "${brand}" selling "${product}" to "${avatar}" in "${sub}". Brandy Melville simplicity + Glossier identity-first copy.

Return ONLY JSON: {"domain":"suggested.com","heroSection":{"headline":"text","subline":"text","cta":"text"},"navigation":["l1","l2","l3","l4"],"productDescription":"identity-first 2 sentences","upsellLogic":"what + why","emailCaptureIdea":"lead magnet","seoTitle":"meta title","seoDescription":"meta desc","shopifyTheme":"theme + why"}`,

  content: (brand, product, sub, avatar, identity) => `Viral content strategy for "${brand}" / "${product}" targeting "${avatar}" in "${sub}". Identity: "${identity}". 30s rule: X-factor product reveal at exactly 30s.

Return ONLY JSON: {"stitchVideo":{"findQuery":"search term to find existing viral video to stitch","whyItWorks":"why this sets up the product perfectly"},"heroScript":{"hook_0_3s":"hook","setup_3_30s":"build tension","reveal_30s":"X-FACTOR product reveal","cta_30_60s":"close + CTA","viralMechanic":"why algorithm pushes this"},"retargetingAd":{"headline":"headline","body":"2 sentences","cta":"button text"}}`,
 
  supplier: (brand, product, sub, price) => `Sourcing brief for "${brand}" / "${product}". Retail: ${price}.

Return ONLY JSON: {"sourcingRegion":"best Chinese city and why","factorySpec":{"materials":"specs","moq":"XXX units","targetCOGS":"$X-$X","margin":"XX%","leadTime":"X weeks"},"alibabaTerms":["t1","t2"],"outreachMessage":"copy-paste English message","sampleChecklist":["s1","s2","s3"],"budget":{"inventory":"$X,XXX","ads":"$2,000","total":"$X,XXX"}}`,
};

// ─── STAGES ───────────────────────────────────────────────────────────────────
const STAGES = [
  { id:"gap",      label:"Brand Gap",         icon:"◎", color:"#111827", desc:"Sub-community scan" },
  { id:"youtube",  label:"YouTube Data",      icon:"▶", color:"#2563eb", desc:"Video transcripts",     isData:true },
  { id:"reddit",   label:"Reddit Data",       icon:"⬡", color:"#dc2626", desc:"Community discussions", isData:true },
  { id:"trends",   label:"Google Trends",     icon:"↗", color:"#16a34a", desc:"Search momentum",     isData:true },
  { id:"mine",     label:"Signal Analysis",   icon:"⟁", color:"#2563eb", desc:"Reading community data" },
  { id:"validate", label:"Validation",        icon:"◈", color:"#d97706", desc:"Timing + pricing" },
  { id:"avatar",   label:"Avatar",            icon:"◉", color:"#7c3aed", desc:"The tribe" },
  { id:"brands",   label:"Brand Research",    icon:"◌", color:"#16a34a", desc:"Aesthetic DNA" },
  { id:"brand",    label:"Brand Identity",    icon:"◆", color:"#d97706", desc:"Name + colors + copy" },
  { id:"shopify",  label:"Website Brief",     icon:"▣", color:"#db2777", desc:"Shopify architecture" },
  { id:"content",  label:"Content Strategy",  icon:"✦", color:"#2563eb", desc:"Viral scripts" },
  { id:"supplier", label:"Supplier Pack",     icon:"⬡", color:"#111827", desc:"Alibaba + budget" },
];

// ─── ATOMS ────────────────────────────────────────────────────────────────────
const Spin = ({ size = 14, color = "#111827" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="40" strokeDashoffset="15" strokeLinecap="round" />
  </svg>
);

const Badge = ({ children, color = "#111827", bg }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 8px", borderRadius: 99,
    fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 400,
    color, background: bg || `${color}12`,
    border: `1px solid ${color}20`, whiteSpace: "nowrap"
  }}>{children}</span>
);

const Divider = () => <div style={{ height: 1, background: "var(--gray-100)", margin: "20px 0" }} />;

const Label = ({ children, color }) => (
  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: color || "var(--gray-400)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
    {children}
  </div>
);

const Row = ({ k, v }) => !v ? null : (
  <div style={{ display: "flex", gap: 16, marginBottom: 10, alignItems: "flex-start" }}>
    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-400)", minWidth: 110, flexShrink: 0, paddingTop: 1 }}>{k}</span>
    <span style={{ fontSize: 13, color: "var(--gray-700)", lineHeight: 1.6, flex: 1 }}>{String(v)}</span>
  </div>
);

const Card = ({ children, style = {} }) => (
  <div style={{
    background: "var(--white)", border: "1px solid var(--gray-200)",
    borderRadius: "var(--radius)", padding: "16px 20px",
    boxShadow: "var(--shadow-sm)", ...style
  }}>
    {children}
  </div>
);

const StatCard = ({ value, label, color = "var(--gray-900)" }) => (
  <div style={{
    padding: "14px 16px", border: "1px solid var(--gray-200)",
    borderRadius: "var(--radius)", background: "var(--white)", flex: 1,
    boxShadow: "var(--shadow-sm)"
  }}>
    <div style={{ fontSize: 20, fontFamily: "var(--font-serif)", color, lineHeight: 1.2, marginBottom: 4 }}>{value || "—"}</div>
    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", letterSpacing: "0.06em" }}>{label}</div>
  </div>
);

// ─── RESULT PANELS ────────────────────────────────────────────────────────────
const Panels = {
  gap: ({ d }) => (
    <div>
      <Card style={{ background: "var(--gray-900)", border: "none", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-500)", marginBottom: 8, letterSpacing: "0.08em" }}>BRAND GAP IDENTIFIED</div>
        <div style={{ fontSize: 36, fontFamily: "var(--font-serif)", color: "var(--white)", lineHeight: 1.1, marginBottom: 6 }}>{d.winnerProduct}</div>
        <div style={{ fontSize: 13, color: "var(--gray-400)", marginBottom: 16 }}>{d.parentMarket} → {d.winnerSubCommunity}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[["Gap Score", `${d.gapScore}/10`], ["CAGR", d.cagr], ["Saturation", d.brandSaturation], ["Market Size", d.parentMarketSize]].map(([k, v]) => (
            <div key={k} style={{ padding: "8px 14px", background: "rgba(255,255,255,0.07)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ fontSize: 15, fontFamily: "var(--font-serif)", color: "var(--white)" }}>{v}</div>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gray-500)", letterSpacing: "0.06em", marginTop: 2 }}>{k}</div>
            </div>
          ))}
        </div>
      </Card>
      <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--gray-600)", fontStyle: "italic", paddingLeft: 14, borderLeft: "2px solid var(--gray-200)", marginBottom: 20 }}>{d.whyThisGap}</p>
      <Row k="People say" v={`"${d.howPeopleReferToIt}"`} />
      <Row k="Dominant brands" v={d.dominantBrands?.join(", ") || "none yet"} />
      <Divider />
      <Label>Sub-communities evaluated</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {d.subCommunities?.map((s, i) => (
          <div key={i} style={{
            display: "flex", gap: 12, alignItems: "center", padding: "10px 14px",
            border: `1px solid ${s.name === d.winnerSubCommunity ? "var(--gray-900)" : "var(--gray-200)"}`,
            borderRadius: "var(--radius-sm)", background: s.name === d.winnerSubCommunity ? "var(--gray-50)" : "transparent"
          }}>
            <span style={{ fontSize: 11, color: s.name === d.winnerSubCommunity ? "var(--gray-900)" : "var(--gray-300)", fontFamily: "var(--font-mono)", minWidth: 14 }}>
              {s.name === d.winnerSubCommunity ? "→" : "·"}
            </span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-900)" }}>{s.name}</span>
              <span style={{ fontSize: 12, color: "var(--gray-400)", marginLeft: 8 }}>{s.products?.join(", ")}</span>
            </div>
            <Badge color={s.growthSignal === "strong" ? "#16a34a" : "#d97706"}>{s.growthSignal}</Badge>
          </div>
        ))}
      </div>
    </div>
  ),

  youtube: ({ d }) => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <Badge color="#2563eb">{d.videosFound} videos found</Badge>
        <Badge color="#16a34a">{d.videosWithTranscripts} transcripts</Badge>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {(d.videos || []).slice(0, 8).map((v, i) => (
          <div key={i} style={{ padding: "10px 14px", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-900)", marginBottom: 2 }}>{v.title}</div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", display: "flex", gap: 10 }}>
                <span>{v.channelTitle}</span>
                {v.viewCount && <span>{Number(v.viewCount).toLocaleString()} views</span>}
              </div>
            </div>
            <Badge color={v.transcript ? "#16a34a" : "#9ca3af"}>{v.transcript ? "✓ transcript" : "no captions"}</Badge>
          </div>
        ))}
      </div>
      {d.corpus && <>
        <Divider />
        <Label>Transcript corpus preview</Label>
        <div style={{ padding: "12px 14px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.8, color: "var(--gray-500)", maxHeight: 180, overflowY: "auto" }}>
          {d.corpus.slice(0, 600)}…
        </div>
      </>}
    </div>
  ),

  reddit: ({ d }) => (
  <div>
    <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      <Badge color="#dc2626">{d.postsFound} posts found</Badge>
      {(d.subreddits || []).slice(0, 4).map((s, i) => (
        <Badge key={i} color="#6B7280">r/{s}</Badge>
      ))}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
      {(d.posts || []).slice(0, 8).map((p, i) => (
        <div key={i} style={{ padding: "10px 14px", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#dc2626", marginBottom: 3 }}>r/{p.subreddit}</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-900)", marginBottom: 4 }}>{p.title}</div>
          <div style={{ fontSize: 11, color: "var(--gray-500)", lineHeight: 1.6 }}>{p.snippet}</div>
        </div>
      ))}
    </div>
    {d.signals?.buyingSignals?.length > 0 && <>
      <Divider />
      <Label>Buying signals</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {d.signals.buyingSignals.map((s, i) => (
          <div key={i} style={{ padding: "8px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--gray-700)" }}>✓ {s}</div>
        ))}
      </div>
    </>}
    {d.corpus && <>
      <Divider />
      <Label>Corpus preview</Label>
      <div style={{ padding: "12px 14px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.8, color: "var(--gray-500)", maxHeight: 180, overflowY: "auto" }}>
        {d.corpus.slice(0, 600)}…
      </div>
    </>}
  </div>
),
  
 trends: ({ d }) => {
  const momentum = d.trend?.momentum || 0;
  const peakValue = d.trend?.peakValue || 0;
  const currentValue = d.trend?.currentValue || 0;
  const score = d.trend?.score || 0;
  const atPeak = d.trend?.atPeak;
  const compositeScore = d.compositeScore || score;

  const momentumExplain =
    momentum > 20  ? "Search interest is growing fast — people are actively discovering this right now. Move quickly." :
    momentum > 0   ? "Search interest is slowly climbing — the market is warming up. Good early signal." :
    momentum === 0 ? "Search interest is stable — steady demand exists but no rush yet. You have a window." :
                     "Search interest is cooling down — either seasonal or fading. Validate before investing.";

  const peakExplain =
    atPeak ? "Currently at peak interest — maximum visibility right now but competition may follow soon." :
    currentValue >= peakValue * 0.6 ? "Near peak levels — strong interest with room to grow before mainstream saturation." :
    "Well below peak — either early stage or recovering. Watch for a rising trend before launching.";

  const brandRiskExplain =
    d.brandSaturationRisk === 'LOW'    ? "No brands appearing in search — the gap is real and unowned right now." :
    d.brandSaturationRisk === 'MEDIUM' ? "A few brand names are showing up in searches — someone is moving in. Act fast." :
                                          "Brands are actively competing here — you'll need strong differentiation to win.";

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <StatCard value={d.trend?.direction} label="Direction" color={d.trend?.direction?.includes("RISING") ? "#16a34a" : "var(--gray-900)"} />
        <StatCard value={d.interpretation?.verdict} label="Timing" color={d.interpretation?.verdict === "PERFECT TIMING" ? "#16a34a" : "#d97706"} />
        <StatCard value={`${compositeScore}/10`} label="Composite Score" />
      </div>
<div style={{ padding: "12px 16px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", marginBottom: 20 }}>
  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-700)", marginBottom: 4 }}>What is the Composite Score?</div>
  <div style={{ fontSize: 12, color: "var(--gray-500)", lineHeight: 1.6 }}>
    Instead of judging timing on one search term, we triangulate 3 signals: the exact product ({d.triangulation?.[0]?.term}), the sub-community ({d.triangulation?.[1]?.term}), and how people refer to it organically. Each is weighted — product counts 50%, community 30%, organic language 20%. A score of 8–10 means all 3 signals agree the timing is right. A score below 5 means demand exists but isn't growing yet.
  </div>
</div>
      {/* Triangulation badges */}
      {d.triangulation && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
          {d.triangulation.map((t, i) => (
            <div key={i} style={{ padding: "6px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-500)" }}>{t.term}</span>
              <Badge color={t.score >= 7 ? "#16a34a" : t.score >= 5 ? "#d97706" : "#dc2626"}>{t.score}/10</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Momentum */}
      <div style={{ marginBottom: 16 }}>
        <Row k="Momentum" v={d.interpretation?.momentum} />
        <div style={{ marginLeft: 126, fontSize: 12, color: "var(--gray-500)", lineHeight: 1.6, fontStyle: "italic" }}>
          {momentumExplain}
        </div>
      </div>

      {/* Peak value */}
      <div style={{ marginBottom: 16 }}>
        <Row k="Peak value" v={`${peakValue} / Current: ${currentValue}`} />
        <div style={{ marginLeft: 126, fontSize: 12, color: "var(--gray-500)", lineHeight: 1.6, fontStyle: "italic" }}>
          {peakExplain}
        </div>
      </div>

      {/* Brand saturation risk */}
      <div style={{ marginBottom: 16 }}>
        <Row k="Brand risk" v={d.brandSaturationRisk || "—"} />
        <div style={{ marginLeft: 126, fontSize: 12, color: "var(--gray-500)", lineHeight: 1.6, fontStyle: "italic" }}>
          {brandRiskExplain}
        </div>
      </div>

      {/* Launch window */}
      {d.launchWindowOpen !== undefined && (
        <div style={{ padding: "12px 16px", background: d.launchWindowOpen ? "#f0fdf4" : "#fef9c3", border: `1px solid ${d.launchWindowOpen ? "#16a34a" : "#d97706"}`, borderRadius: "var(--radius-sm)", marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: d.launchWindowOpen ? "#16a34a" : "#d97706", marginBottom: 4 }}>
            {d.launchWindowOpen ? "✓ Launch window is open" : "⚠ Launch window uncertain"}
          </div>
          <div style={{ fontSize: 12, color: "var(--gray-600)", lineHeight: 1.6 }}>
            {d.interpretation?.recommendation}
          </div>
        </div>
      )}

      <Divider />
      <Label>Rising search queries</Label>
      {(d.risingQueries || []).length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--gray-400)", fontStyle: "italic" }}>No rising queries detected — very early stage market with minimal search history.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(d.risingQueries || []).slice(0, 6).map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
              <span style={{ flex: 1, fontSize: 12, color: "var(--gray-700)" }}>{q.query}</span>
              <Badge color="#16a34a">{q.value}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
},

  mine: ({ d }) => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Badge color={d.dataSource?.includes("REAL") ? "#16a34a" : "#d97706"}>
          {d.dataSource?.includes("REAL") ? `✓ Real data (${d.dataSource})` : "~ Simulated"}
        </Badge>
        <Badge color="#16a34a">{d.verdict}</Badge>
        {d.postsAnalyzed > 0 && <Badge color="#16a34a">{d.postsAnalyzed} Reddit posts</Badge>}
      </div>
      <Card style={{ background: "var(--gray-50)", marginBottom: 16 }}>
        <Label>Key quotes from community</Label>
        {d.keyQuotes?.map((q, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: i < d.keyQuotes.length - 1 ? "1px solid var(--gray-200)" : "none", display: "flex", gap: 10 }}>
            <span style={{ color: "var(--gray-300)", fontFamily: "var(--font-mono)", fontSize: 11, minWidth: 18, paddingTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontSize: 13, fontStyle: "italic", color: "var(--gray-700)", lineHeight: 1.7 }}>"{q}"</span>
          </div>
        ))}
      </Card>
      <p style={{ fontSize: 13, color: "var(--gray-600)", lineHeight: 1.7, marginBottom: 16 }}>{d.confirmation}</p>
      <Label>Product mentions</Label>
      {d.productMentions?.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 12, marginBottom: 8, padding: "10px 14px", border: `1px solid ${i === 0 ? "var(--gray-900)" : "var(--gray-200)"}`, borderRadius: "var(--radius-sm)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 500, fontSize: 13 }}>{p.product}</span>
              <Badge color={p.brandAwareness === "NONE" ? "#16a34a" : "#d97706"}>brand: {p.brandAwareness}</Badge>
            </div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>"{p.genericLanguage}" · {p.mentionCount}× mentioned</div>
          </div>
        </div>
      ))}
    </div>
  ),

  validate: ({ d }) => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Badge color={d.dataSource === "REAL_GOOGLE_TRENDS" ? "#16a34a" : "#d97706"}>
          {d.dataSource === "REAL_GOOGLE_TRENDS" ? "✓ Real trends" : "~ Simulated"}
        </Badge>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <StatCard value={d.diffusionStage} label="Diffusion stage" />
        <StatCard value={d.verdict} label="Timing" color={d.verdict === "PERFECT TIMING" ? "#16a34a" : "#d97706"} />
        <StatCard value={`${d.confidence}/10`} label="Confidence" />
      </div>
      <Row k="Trend" v={d.trendStatus} /><Row k="Momentum" v={d.trendMomentum} />
      <Row k="Saturation" v={d.brandSaturation} /><Row k="Retail price" v={d.suggestedRetailPrice} />
      <Row k="Cost to make" v={d.costToManufacture} /><Row k="Gross margin" v={d.grossMarginPotential} />
      <Divider />
      <p style={{ fontSize: 13, lineHeight: 1.8, color: "var(--gray-500)", fontStyle: "italic" }}>{d.windowOfOpportunity}</p>
    </div>
  ),

  avatar: ({ d }) => (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 28, fontFamily: "var(--font-serif)", marginBottom: 4 }}>{d.personaName}</div>
        <div style={{ fontSize: 13, color: "var(--gray-500)" }}>{d.age} · {d.tribeLabel}</div>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.9, fontStyle: "italic", color: "var(--gray-700)", paddingLeft: 14, borderLeft: "2px solid var(--gray-200)", marginBottom: 20 }}>"{d.tribalEssence}"</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
        {d.identityKeywords?.map((k, i) => <Badge key={i} color="#7c3aed">{k}</Badge>)}
      </div>
      <Divider />
      <Label>YouTube title patterns they create</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {d.youtubeTitlePatterns?.map((t, i) => (
          <div key={i} style={{ padding: "8px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-600)" }}>{t}</div>
        ))}
      </div>
      <Divider />
      <Row k="Aspiration" v={d.aspirationalSelf} /><Row k="Pain point" v={d.painPoint} />
      <Row k="Wants to feel" v={d.whatTheyWantToFeel} /><Row k="Brand killer" v={d.whatRepelsThem} />
    </div>
  ),

  brands: ({ d }) => (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {d.inspirationBrands?.map((b, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: "var(--gray-900)" }}>{b.brand}</span>
              <span style={{ fontSize: 12, color: "var(--gray-400)" }}>{b.category}</span>
              <Badge color="#16a34a">{b.visualKeyword}</Badge>
            </div>
            <p style={{ fontSize: 13, color: "var(--gray-600)", lineHeight: 1.7 }}>{b.whySameAvatar}</p>
          </Card>
        ))}
      </div>
      <Divider />
      <Label>Photography brief — for the actual shoot</Label>
      <p style={{ fontSize: 13, lineHeight: 1.9, color: "var(--gray-700)", marginBottom: 16 }}>{d.photographyBrief}</p>
      <Label>Model direction</Label>
      <p style={{ fontSize: 13, lineHeight: 1.8, color: "var(--gray-600)" }}>{d.modelDirection}</p>
    </div>
  ),

  brand: ({ d }) => {
    const p = d.colorPalette || {};
    return (
      <div>
        <Card style={{ background: "var(--gray-900)", border: "none", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 48, fontFamily: "var(--font-serif)", color: "var(--white)", lineHeight: 1 }}>{d.winner}</div>
              <div style={{ fontSize: 14, fontStyle: "italic", color: "var(--gray-400)", marginTop: 6 }}>"{d.tagline}"</div>
            </div>
            <div style={{ display: "flex", gap: 5, paddingTop: 4 }}>
              {Object.entries(p).map(([k, v]) => (
                <div key={k} title={k} style={{ width: 20, height: 20, borderRadius: "50%", background: v, border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
              ))}
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--gray-400)", lineHeight: 1.7 }}>{d.brandPromise}</p>
        </Card>
        <Card style={{ marginBottom: 16 }}>
          <Label>Hero website copy</Label>
          <div style={{ fontSize: 22, fontFamily: "var(--font-serif)", color: "var(--gray-900)", marginBottom: 6, lineHeight: 1.3 }}>{d.websiteHeroHeadline}</div>
          <div style={{ fontSize: 13, color: "var(--gray-500)", marginBottom: 14 }}>{d.websiteHeroSubline}</div>
          <div style={{ display: "inline-block", padding: "8px 18px", background: "var(--gray-900)", color: "white", fontSize: 12, fontWeight: 500, borderRadius: "var(--radius-sm)", letterSpacing: "0.03em" }}>{d.ctaText}</div>
        </Card>
        <Row k="Brand voice" v={d.brandVoice} />
        <Row k="Not" v={d.whatItIsNot} />
        <Divider />
        <Label>Name options</Label>
        {d.nameOptions?.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 14, marginBottom: 8, padding: "10px 14px", border: `1px solid ${n.name === d.winner ? "var(--gray-900)" : "var(--gray-200)"}`, borderRadius: "var(--radius-sm)", background: n.name === d.winner ? "var(--gray-50)" : "transparent" }}>
            <div style={{ minWidth: 80 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: n.name === d.winner ? "var(--gray-900)" : "var(--gray-600)" }}>{n.name}</div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", marginTop: 2 }}>{n.aspirationalQuality}</div>
            </div>
            <div style={{ flex: 1, fontSize: 12, color: "var(--gray-500)", lineHeight: 1.6 }}>{n.logic}</div>
            {n.name === d.winner && <span style={{ color: "var(--gray-900)", fontSize: 12, alignSelf: "center" }}>✓</span>}
          </div>
        ))}
      </div>
    );
  },

  shopify: ({ d }) => (
  <div>
    <Row k="Domain" v={d.domain} />
    <Row k="Theme" v={d.shopifyTheme} />
    <Divider />
    <Label>Hero section</Label>
    <Card style={{ padding: "12px 16px", marginBottom: 16 }}>
      <Row k="Headline" v={d.heroSection?.headline} />
      <Row k="Subline" v={d.heroSection?.subline} />
      <Row k="CTA" v={d.heroSection?.cta} />
    </Card>
    <Label>Navigation</Label>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {(d.navigation || []).map((n, i) => (
        <div key={i} style={{ padding: "6px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--gray-700)", fontFamily: "var(--font-mono)" }}>{n}</div>
      ))}
    </div>
    <Label>Product description — identity-first</Label>
    <Card style={{ background: "var(--gray-50)", marginBottom: 16 }}>
      <p style={{ fontSize: 13, lineHeight: 2, color: "var(--gray-700)" }}>{d.productDescription}</p>
    </Card>
    <Divider />
    <Row k="Upsell logic" v={d.upsellLogic} />
    <Row k="Email capture" v={d.emailCaptureIdea} />
    <Row k="SEO title" v={d.seoTitle} />
    <Row k="SEO description" v={d.seoDescription} />
  </div>
),

  content: ({ d }) => (
  <div>
    {/* Stitch Video */}
    {d.stitchVideo && (
      <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: "var(--gray-900)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--white)" }}>Stitch Video to Find</span>
          <Badge color="white">STEP 1</Badge>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <Label>Search for</Label>
          <p style={{ fontSize: 12, color: "var(--gray-700)", lineHeight: 1.6, marginBottom: 10 }}>{d.stitchVideo.findQuery}</p>
          <Label>Why it works</Label>
          <p style={{ fontSize: 12, color: "var(--gray-600)", lineHeight: 1.6 }}>{d.stitchVideo.whyItWorks}</p>
        </div>
      </Card>
    )}

    {/* Hero Script */}
    {d.heroScript && (
      <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: "var(--gray-900)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--white)" }}>Hero Script</span>
          <Badge color="white">STEP 2</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {[["Hook 0–3s", d.heroScript.hook_0_3s, "#dc2626"], ["Build 3–30s", d.heroScript.setup_3_30s, "var(--gray-500)"], ["⚡ 30s Reveal", d.heroScript.reveal_30s, "#d97706"], ["CTA 30–60s", d.heroScript.cta_30_60s, "var(--gray-500)"]].map(([lbl, val, c], j) => (
            <div key={j} style={{ padding: "12px 16px", borderRight: j % 2 === 0 ? "1px solid var(--gray-200)" : "none", borderBottom: j < 2 ? "1px solid var(--gray-200)" : "none" }}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: c, letterSpacing: "0.06em", marginBottom: 6 }}>{lbl}</div>
              <p style={{ fontSize: 12, color: "var(--gray-700)", lineHeight: 1.7 }}>{val}</p>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--gray-200)", background: "var(--gray-50)" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>Why it spreads: </span>
          <span style={{ fontSize: 11, color: "var(--gray-600)", fontStyle: "italic" }}>{d.heroScript.viralMechanic}</span>
        </div>
      </Card>
    )}

    {/* Retargeting Ad */}
    {d.retargetingAd && (
      <>
        <Divider />
        <Label>Retargeting Ad (50%+ viewers)</Label>
        <Card style={{ padding: "12px 16px" }}>
          <Row k="Headline" v={d.retargetingAd.headline} />
          <Row k="Body" v={d.retargetingAd.body} />
          <Row k="CTA" v={d.retargetingAd.cta} />
        </Card>
      </>
    )}
  </div>
),
  supplier: ({ d }) => {
  const b = d.factorySpec || {};
  const bud = d.budget || {};
  return (
    <div>
      {/* Sourcing Region */}
      {d.sourcingRegion && (
        <div style={{ padding: "12px 16px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", marginBottom: 20 }}>
          <Label>Best sourcing region</Label>
          <p style={{ fontSize: 12, color: "var(--gray-700)", lineHeight: 1.6 }}>{d.sourcingRegion}</p>
        </div>
      )}

      {/* Factory specs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {[["MOQ", b.moq], ["COGS", b.targetCOGS], ["Margin", b.margin], ["Lead time", b.leadTime]].map(([k, v]) => v && <StatCard key={k} value={v} label={k} />)}
      </div>
      <Row k="Materials" v={b.materials} />

      <Divider />

      {/* Alibaba search terms */}
      {d.alibabaTerms?.length > 0 && (
        <>
          <Label>Alibaba search terms</Label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {d.alibabaTerms.map((t, i) => (
              <div key={i} style={{ padding: "6px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--gray-700)", fontFamily: "var(--font-mono)" }}>{t}</div>
            ))}
          </div>
        </>
      )}

      {/* Sample checklist */}
      {d.sampleChecklist?.length > 0 && (
        <>
          <Label>Sample checklist</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {d.sampleChecklist.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--gray-700)" }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span> {s}
              </div>
            ))}
          </div>
        </>
      )}

      <Divider />

      {/* Outreach message */}
      <Label>Outreach message — copy and paste</Label>
      <pre style={{ fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", lineHeight: 1.8, padding: "14px 16px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", color: "var(--gray-700)", marginBottom: 16 }}>{d.outreachMessage}</pre>

      {/* Budget */}
      <Label>Budget estimate</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {Object.entries(bud).map(([k, v]) => (
          <div key={k} style={{ textAlign: "center", padding: "12px 6px", background: k === "total" ? "var(--gray-900)" : "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: 14, fontFamily: "var(--font-serif)", color: k === "total" ? "white" : "var(--gray-900)", marginBottom: 4 }}>{v}</div>
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: k === "total" ? "var(--gray-500)" : "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
};
// ─── PPT GENERATOR — DARK CINEMATIC ───────────────────────────────────────
function loadPptxGen() {
  return new Promise((res, rej) => {
    if (window.PptxGenJS) { res(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function generatePPT(results, market) {
  await loadPptxGen();
  const pres = new window.PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const brand  = results.brand?.winner || 'BRAND';
  const product = results.gap?.winnerProduct || 'Product';
  const pal    = results.brand?.colorPalette || {};

  // ── Color system ─────────────────────────────────────────────────────────────
  const raw = {
    primary:   (pal.primary   || '#1a1a2e').replace('#',''),
    secondary: (pal.secondary || '#16213e').replace('#',''),
    accent:    (pal.accent    || '#e94560').replace('#',''),
    bg:        (pal.bg        || '#F8F7F4').replace('#',''),
  };
  const C = {
    ink:   '0D0D0D',   // near-black base
    coal:  '141414',   // card backgrounds
    dark:  '1C1C1C',   // slightly lighter panels
    steel: '2A2A2A',   // dividers / borders
    mid:   '6B7280',   // secondary text
    muted: '9CA3AF',   // labels
    ghost: '3A3A3A',   // subtle fills
    white: 'FFFFFF',
    offwh: 'F0EFEC',   // warm off-white text
    ac:    raw.accent, // brand accent
    p1:    raw.primary,
    p2:    raw.secondary,
  };

  const W = 13.3, H = 7.5;

  // ── Design helpers ────────────────────────────────────────────────────────────
  const glow  = () => ({ type:'outer', blur:18, offset:3, angle:135, color:C.ac,  opacity:0.18 });
  const elev  = () => ({ type:'outer', blur:10, offset:3, angle:135, color:'000000', opacity:0.35 });
  const soft  = () => ({ type:'outer', blur:5,  offset:2, angle:135, color:'000000', opacity:0.20 });

  // Slide header — full-width dark bar with accent left stripe
  const hdr = (sl, title, sub='') => {
    sl.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:W, h:1.05, fill:{color:C.ink}, line:{color:C.ink} });
    sl.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.22, h:1.05, fill:{color:C.ac}, line:{color:C.ac} });
    sl.addText(title, { x:0.42, y:0, w:8.5, h:1.05, fontSize:26, fontFace:'Georgia', bold:true, color:C.white, valign:'middle', margin:0 });
    if (sub) sl.addText(sub.toUpperCase(), { x:W-4.8, y:0, w:4.6, h:1.05, fontSize:8, fontFace:'Calibri', color:C.muted, valign:'middle', align:'right', charSpacing:2, margin:0 });
  };

  // Stat card — dark glass style
  const card = (sl, x, y, w, h, val, lbl, opts={}) => {
    const bg = opts.ac ? C.ac : opts.p1 ? C.p1 : C.dark;
    const vc = opts.ac || opts.p1 ? C.white : C.offwh;
    const lc = opts.ac || opts.p1 ? 'rgba(255,255,255,0.65)' : C.muted;
    sl.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill:{color:bg}, line:{color:C.steel}, shadow:soft() });
    sl.addText(String(val||'—'), { x:x+0.12, y, w:w-0.24, h:h*0.62, fontSize:opts.fs||22, fontFace:'Georgia', bold:true, color:vc, align:'center', valign:'middle', margin:0 });
    sl.addText(lbl, { x:x+0.08, y:y+h*0.60, w:w-0.16, h:h*0.38, fontSize:6.5, fontFace:'Calibri', color:lc, align:'center', charSpacing:2, margin:0 });
  };

  // Accent rule line
  const rule = (sl, x, y, w) => sl.addShape(pres.shapes.RECTANGLE, { x, y, w, h:0.025, fill:{color:C.ac}, line:{color:C.ac} });

  // Subtle divider
  const div = (sl, x, y, w) => sl.addShape(pres.shapes.RECTANGLE, { x, y, w, h:0.012, fill:{color:C.steel}, line:{color:C.steel} });

  // Label (small caps)
  const lbl = (sl, x, y, w, text, color=C.muted) =>
    sl.addText(text.toUpperCase(), { x, y, w, h:0.28, fontSize:6.5, fontFace:'Calibri', color, charSpacing:2.5, margin:0 });

  // Body text
  const body = (sl, x, y, w, h, text, fs=10, color=C.offwh) =>
    sl.addText(String(text||''), { x, y, w, h, fontSize:fs, fontFace:'Calibri', color, wrap:true, valign:'top', margin:0 });

  // Quote block with left accent bar
  const quote = (sl, x, y, w, h, text, fs=11) => {
    sl.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill:{color:C.coal}, line:{color:C.steel} });
    sl.addShape(pres.shapes.RECTANGLE, { x, y, w:0.07, h, fill:{color:C.ac}, line:{color:C.ac} });
    sl.addText(`"${text}"`, { x:x+0.18, y, w:w-0.28, h, fontSize:fs, fontFace:'Georgia', italic:true, color:C.offwh, wrap:true, valign:'middle', margin:6 });
  };

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 1 — COVER
  // ════════════════════════════════════════════════════════════════════════════
  const s1 = pres.addSlide();
  s1.background = { color: C.ink };

  // Full-height accent stripe
  s1.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.28, h:H, fill:{color:C.ac}, line:{color:C.ac} });

  // Right stat panel
  s1.addShape(pres.shapes.RECTANGLE, { x:W-4.0, y:0, w:4.0, h:H, fill:{color:C.coal}, line:{color:C.steel} });
  rule(s1, W-4.0, 0, 4.0);

  // Brand name — massive Georgia
  s1.addText(brand.toUpperCase(), {
    x:0.6, y:0.9, w:W-5.0, h:3.0,
    fontSize:82, fontFace:'Georgia', bold:true, color:C.white, margin:0
  });

  if (results.brand?.tagline) {
    s1.addText(`"${results.brand.tagline}"`, {
      x:0.6, y:4.1, w:W-5.0, h:0.7,
      fontSize:16, fontFace:'Georgia', italic:true, color:C.muted, margin:0
    });
  }
  rule(s1, 0.6, 4.95, W-5.2);
  s1.addText(product.toUpperCase(), { x:0.6, y:5.1, w:W-5.2, h:0.35, fontSize:10, fontFace:'Calibri', color:C.ac, charSpacing:3, margin:0 });
  s1.addText(market.toUpperCase(), { x:0.6, y:5.5, w:W-5.2, h:0.3, fontSize:9, fontFace:'Calibri', color:C.muted, charSpacing:3, margin:0 });

  // Right panel stats
  s1.addText('BRAND REPORT', { x:W-3.8, y:0.38, w:3.6, h:0.3, fontSize:8, fontFace:'Calibri', color:C.muted, charSpacing:3, align:'center', margin:0 });
  div(s1, W-3.8, 0.82, 3.6);

  const cStats = [
    ['Gap Score', `${results.gap?.gapScore||'—'}/10`],
    ['Market Size', results.gap?.parentMarketSize||'—'],
    ['Saturation', results.gap?.brandSaturation||'—'],
    ['CAGR', results.gap?.cagr||'—'],
    ['Retail Price', results.validate?.suggestedRetailPrice||results.gap?.suggestedRetailPrice||'—'],
    ['Gross Margin', results.validate?.grossMarginPotential||results.gap?.grossMarginPotential||'—'],
  ];
  cStats.forEach(([k,v], i) => {
    const y = 1.0 + (i*1.05);
    s1.addText(String(v), { x:W-3.8, y, w:3.6, h:0.62, fontSize:22, fontFace:'Georgia', bold:true, color:i===0?C.ac:C.white, align:'center', valign:'middle', margin:0 });
    s1.addText(k.toUpperCase(), { x:W-3.8, y:y+0.58, w:3.6, h:0.22, fontSize:6.5, fontFace:'Calibri', color:C.muted, align:'center', charSpacing:2, margin:0 });
    if (i<5) div(s1, W-3.4, y+0.85, 2.8);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 2 — THE BRAND GAP
  // ════════════════════════════════════════════════════════════════════════════
  if (results.gap) {
    const s2 = pres.addSlide();
    s2.background = { color:C.ink };
    hdr(s2, 'The Brand Gap', results.gap.winnerSubCommunity);

    // Hero gap statement
    quote(s2, 0.5, 1.22, 12.3, 1.0, results.gap.whyThisGap||'', 12);

    // 4 stat cards
    const gStats = [
      ['GAP SCORE', `${results.gap.gapScore}/10`, {ac:true, fs:28}],
      ['CAGR',      results.gap.cagr,              {fs:22}],
      ['SATURATION',results.gap.brandSaturation,   {fs:18}],
      ['MARKET SIZE',results.gap.parentMarketSize, {fs:16}],
    ];
    gStats.forEach(([k,v,o], i) => card(s2, 0.5+(i*3.1), 2.42, 2.9, 1.0, v, k, o));

    // People say / dominant brands
    s2.addShape(pres.shapes.RECTANGLE, { x:0.5, y:3.6, w:12.3, h:0.68, fill:{color:C.dark}, line:{color:C.steel} });
    s2.addText('PEOPLE SAY', { x:0.7, y:3.6, w:2.2, h:0.68, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, valign:'middle', margin:0 });
    s2.addText(`"${results.gap.howPeopleReferToIt}"  —  not a brand name`, { x:2.9, y:3.6, w:6.0, h:0.68, fontSize:14, fontFace:'Georgia', italic:true, color:C.ac, valign:'middle', margin:0 });
    s2.addText('DOMINANT BRANDS', { x:8.9, y:3.6, w:2.0, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, valign:'middle', margin:0 });
    s2.addText(results.validate?.dominantBrands?.join(', ') || results.gap.dominantBrands?.join(', ') || 'none yet', { x:8.9, y:3.9, w:3.7, h:0.35, fontSize:11, fontFace:'Calibri', color:C.offwh, valign:'middle', margin:0 });

    // Sub-communities
    lbl(s2, 0.5, 4.45, 8, 'Sub-Communities Evaluated');
    (results.gap.subCommunities||[]).slice(0,5).forEach((sc, i) => {
      const isW = sc.name === results.gap.winnerSubCommunity;
      const x = 0.5+(i*2.52);
      s2.addShape(pres.shapes.RECTANGLE, { x, y:4.78, w:2.38, h:1.35, fill:{color:isW?C.ac:C.dark}, line:{color:isW?C.ac:C.steel}, shadow:isW?glow():soft() });
      if (isW) { s2.addText('★  WINNER', { x, y:4.82, w:2.38, h:0.25, fontSize:6.5, fontFace:'Calibri', bold:true, color:'FFFFFF', align:'center', charSpacing:2, margin:0 }); }
      s2.addText(sc.name, { x:x+0.1, y:isW?5.1:4.78, w:2.2, h:isW?0.72:1.35, fontSize:10, fontFace:'Calibri', bold:isW, color:C.white, align:'center', valign:'middle', wrap:true, margin:4 });
      if (sc.winnerProduct) s2.addText(sc.winnerProduct, { x:x+0.1, y:5.88, w:2.2, h:0.2, fontSize:7, fontFace:'Calibri', italic:true, color:isW?'FFFFFFBB':C.muted, align:'center', margin:0 });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 3 — YOUTUBE DATA
  // ════════════════════════════════════════════════════════════════════════════
  if (results.youtube) {
    const s3 = pres.addSlide();
    s3.background = { color:C.ink };
    hdr(s3, 'YouTube Data', `${results.youtube.videosFound||0} videos · ${results.youtube.videosWithTranscripts||0} transcripts`);

    // Stat badges
    card(s3, 0.5, 1.22, 2.8, 0.85, `${results.youtube.videosFound||0}`, 'Videos Found', {fs:26});
    card(s3, 3.5, 1.22, 2.8, 0.85, `${results.youtube.videosWithTranscripts||0}`, 'Transcripts Extracted', {ac:true, fs:26});

    // Video list
    lbl(s3, 0.5, 2.25, 12.3, 'Videos Analyzed');
    (results.youtube.videos||[]).slice(0,7).forEach((v, i) => {
      const y = 2.58+(i*0.68);
      const hasTx = v.transcript;
      s3.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:12.3, h:0.6, fill:{color:i%2===0?C.coal:C.dark}, line:{color:C.steel} });
      s3.addText(v.title||'', { x:0.7, y, w:8.8, h:0.6, fontSize:10, fontFace:'Calibri', color:C.offwh, valign:'middle', wrap:false, margin:0 });
      s3.addText(v.channelTitle||'', { x:9.6, y, w:2.0, h:0.3, fontSize:8, fontFace:'Calibri', color:C.muted, valign:'middle', margin:0 });
      s3.addText(v.viewCount ? `${Number(v.viewCount).toLocaleString()} views` : '', { x:9.6, y:y+0.3, w:2.0, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, margin:0 });
      s3.addShape(pres.shapes.RECTANGLE, { x:11.72, y:y+0.12, w:0.95, h:0.36, fill:{color:hasTx?'16a34a':C.ghost}, line:{color:'transparent'} });
      s3.addText(hasTx?'✓ transcript':'no captions', { x:11.72, y:y+0.12, w:0.95, h:0.36, fontSize:7, fontFace:'Calibri', color:C.white, align:'center', valign:'middle', margin:0 });
    });

    // Corpus preview
    if (results.youtube.corpus) {
      lbl(s3, 0.5, 7.08, 12.3, 'Transcript Corpus Preview');
      s3.addShape(pres.shapes.RECTANGLE, { x:0.5, y:7.32, w:12.3, h:0.6, fill:{color:C.coal}, line:{color:C.steel} });
      s3.addText((results.youtube.corpus||'').slice(0,280)+'…', { x:0.7, y:7.32, w:12.0, h:0.6, fontSize:8, fontFace:'Calibri', color:C.muted, wrap:false, valign:'middle', margin:0 });
    }
  }
// ════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — REDDIT DATA
// ════════════════════════════════════════════════════════════════════════════
if (results.reddit) {
  const sRd = pres.addSlide();
  sRd.background = { color:C.ink };
  hdr(sRd, 'Reddit Data', `${results.reddit.postsFound||0} posts · ${(results.reddit.subreddits||[]).slice(0,3).map(s=>'r/'+s).join(' · ')}`);

  // Stat badges
  card(sRd, 0.5, 1.22, 2.8, 0.85, `${results.reddit.postsFound||0}`, 'Posts Found', {ac:true, fs:26});
  card(sRd, 3.5, 1.22, 2.8, 0.85, (results.reddit.subreddits||[]).length, 'Subreddits', {fs:22});

  // Post list
  lbl(sRd, 0.5, 2.25, 12.3, 'Reddit Discussions Analyzed');
  (results.reddit.posts||[]).slice(0,7).forEach((p, i) => {
  const y = 2.58+(i*0.72);
  sRd.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:12.3, h:0.65, fill:{color:i%2===0?C.coal:C.dark}, line:{color:C.steel} });
  sRd.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:0.06, h:0.65, fill:{color:C.ac}, line:{color:C.ac} });
  sRd.addText(`r/${p.subreddit}`, { x:0.65, y:y+0.04, w:1.6, h:0.22, fontSize:7, fontFace:'Calibri', color:C.ac, margin:0 });
  sRd.addText(p.title||'', { x:0.65, y:y+0.26, w:11.5, h:0.22, fontSize:10, fontFace:'Calibri', bold:true, color:C.offwh, wrap:false, margin:0 });
  sRd.addText(p.snippet||'', { x:0.65, y:y+0.46, w:11.5, h:0.18, fontSize:8, fontFace:'Calibri', color:C.muted, wrap:false, margin:0 });
});

  // Buying signals
  if ((results.reddit.signals?.buyingSignals||[]).length>0) {
    lbl(sRd, 0.5, 7.12, 12.3, 'Buying Signals Detected', C.ac);
    results.reddit.signals.buyingSignals.slice(0,2).forEach((s, i) => {
      sRd.addShape(pres.shapes.RECTANGLE, { x:0.5+(i*6.2), y:7.38, w:5.9, h:0.42, fill:{color:C.dark}, line:{color:C.ac+'55'} });
      sRd.addText(`✓  ${s}`, { x:0.7+(i*6.2), y:7.38, w:5.7, h:0.42, fontSize:9, fontFace:'Calibri', color:C.offwh, valign:'middle', margin:0 });
    });
  }
}
  
  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 5 — GOOGLE TRENDS
  // ════════════════════════════════════════════════════════════════════════════
  if (results.trends) {
    const s4 = pres.addSlide();
    s4.background = { color:C.ink };
    hdr(s4, 'Market Timing', 'Google Trends · Triangulated Signal');

    // 4 stat cards
    const tStats = [
      ['COMPOSITE SCORE', `${results.trends.compositeScore||results.trends.trend?.score||'—'}/10`, {ac:true, fs:26}],
      ['DIRECTION',       results.trends.trend?.direction||'—',             {fs:18}],
      ['BRAND RISK',      results.trends.brandSaturationRisk||'—',          {fs:18}],
      ['VERDICT',         results.trends.interpretation?.verdict||'—',      {fs:12}],
    ];
    tStats.forEach(([k,v,o], i) => card(s4, 0.5+(i*3.1), 1.22, 2.9, 0.92, v, k, o));

    // Triangulation badges
    const tri = results.trends.triangulation||[];
    if (tri.length) {
      lbl(s4, 0.5, 2.32, 12.3, 'Signal Triangulation');
      tri.slice(0,3).forEach((t, i) => {
        const x = 0.5+(i*4.1);
        s4.addShape(pres.shapes.RECTANGLE, { x, y:2.62, w:3.9, h:0.72, fill:{color:C.dark}, line:{color:C.steel} });
        s4.addText(t.term||'', { x:x+0.15, y:2.62, w:2.4, h:0.72, fontSize:10, fontFace:'Calibri', color:C.offwh, valign:'middle', margin:0 });
        const scoreColor = (t.score>=7)?'16a34a':(t.score>=4)?C.ac:'6B7280';
        s4.addShape(pres.shapes.RECTANGLE, { x:x+2.7, y:2.78, w:1.05, h:0.42, fill:{color:scoreColor}, line:{color:'transparent'} });
        s4.addText(`${t.score||0}/10`, { x:x+2.7, y:2.78, w:1.05, h:0.42, fontSize:11, fontFace:'Georgia', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });
      });
    }

    // Bar chart
    const timeline = (results.trends.timelineData||[]).filter(d=>d.value>0).slice(-24);
    if (timeline.length>0) {
      const cx=0.5, cy=3.52, cw=8.2, ch=2.5;
      const maxV = Math.max(...timeline.map(d=>d.value));
      const bw = (cw/timeline.length)*0.72;
      const bg = (cw/timeline.length)*0.28;

      s4.addShape(pres.shapes.RECTANGLE, { x:cx, y:cy, w:cw, h:ch, fill:{color:C.coal}, line:{color:C.steel} });
      [0.25,0.5,0.75,1.0].forEach(p => {
        const gy = cy+ch-(p*ch);
        s4.addShape(pres.shapes.RECTANGLE, { x:cx, y:gy, w:cw, h:0.012, fill:{color:C.ghost}, line:{color:C.ghost} });
        s4.addText(`${Math.round(p*maxV)}`, { x:cx-0.42, y:gy-0.14, w:0.38, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, align:'right', margin:0 });
      });

      timeline.forEach((d, i) => {
        const bh = Math.max(0.05, (d.value/maxV)*(ch-0.12));
        const bx = cx+(i*(bw+bg));
        const by = cy+ch-bh-0.06;
        const isPk = d.value===maxV;
        const isRc = i>=timeline.length-4;
        s4.addShape(pres.shapes.RECTANGLE, {
          x:bx, y:by, w:bw, h:bh,
          fill:{color: isPk?C.ac : isRc?C.p1 : '2E3A45'},
          line:{color: isPk?C.ac : isRc?C.p1 : '2E3A45'},
          shadow: isPk?glow():undefined
        });
      });
      s4.addText('24-month search interest  ·  accent = peak  ·  brand color = last 4 months', {
        x:cx, y:cy+ch+0.08, w:cw, h:0.22, fontSize:7, fontFace:'Calibri', color:C.muted, align:'center', margin:0
      });
    }

    // Right analysis panel
    s4.addShape(pres.shapes.RECTANGLE, { x:8.95, y:3.52, w:4.05, h:3.6, fill:{color:C.coal}, line:{color:C.steel} });
    lbl(s4, 9.12, 3.65, 3.7, 'Analysis');

    const mom = results.trends.trend?.momentum||0;
    const momTxt = mom>20 ? 'Accelerating fast — move now before brands enter.' :
      mom>0  ? 'Slowly climbing — early mover window is open.' :
      mom===0? 'Stable demand — gap is real, unowned, low urgency.' :
               'Cooling — validate before committing inventory.';

    s4.addText(`${mom}% vs 3 months ago`, { x:9.12, y:3.98, w:3.7, h:0.38, fontSize:14, fontFace:'Georgia', bold:true, color:C.ac, margin:0 });
    s4.addText('MOMENTUM', { x:9.12, y:4.38, w:3.7, h:0.22, fontSize:6.5, fontFace:'Calibri', color:C.muted, charSpacing:2, margin:0 });
    body(s4, 9.12, 4.62, 3.7, 0.65, momTxt, 9, C.offwh);

    div(s4, 9.12, 5.32, 3.7);

    const pkVal = results.trends.trend?.peakValue||0;
    const curVal = results.trends.trend?.currentValue||0;
    s4.addText(`${pkVal} / Current: ${curVal}`, { x:9.12, y:5.48, w:3.7, h:0.38, fontSize:13, fontFace:'Georgia', bold:true, color:C.offwh, margin:0 });
    lbl(s4, 9.12, 5.88, 3.7, 'Peak / Current Value');

    // Launch window
    const lw = results.trends.launchWindowOpen;
    const lwColor = lw===true?'16a34a': lw===false?'dc2626':C.ac;
    const lwTxt = lw===true?'✓ Launch window open' : lw===false?'⚠ Window uncertain' : '⚡ Monitor closely';
    s4.addShape(pres.shapes.RECTANGLE, { x:0.5, y:6.2, w:8.2, h:0.62, fill:{color:lwColor+'22'}, line:{color:lwColor} });
    s4.addText(lwTxt, { x:0.7, y:6.2, w:4.0, h:0.62, fontSize:12, fontFace:'Georgia', bold:true, color:lwColor.length===6?'#'+lwColor:C.ac, valign:'middle', margin:0 });
    const rising = (results.trends.risingQueries||[]).slice(0,3);
    if (rising.length) {
      s4.addText('Rising: '+rising.map(q=>q.query).join('  ·  '), { x:4.8, y:6.2, w:4.2, h:0.62, fontSize:9, fontFace:'Calibri', italic:true, color:C.muted, valign:'middle', margin:0 });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 6 — SIGNAL ANALYSIS
  // ════════════════════════════════════════════════════════════════════════════
  if (results.mine) {
    const s5 = pres.addSlide();
    s5.background = { color:C.ink };
    hdr(s5, 'Signal Analysis', `${results.mine.dataSource||'SIMULATED'}`);

    // Source + verdict badges
    const ds = results.mine.dataSource||'SIMULATED';
    const dsC = ds.includes('REAL')?'16a34a':'d97706';
    s5.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.22, w:2.8, h:0.42, fill:{color:dsC}, line:{color:'transparent'} });
    s5.addText(`✓ ${ds}`, { x:0.5, y:1.22, w:2.8, h:0.42, fontSize:8, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });
    s5.addShape(pres.shapes.RECTANGLE, { x:3.42, y:1.22, w:4.0, h:0.42, fill:{color:C.dark}, line:{color:C.steel} });
    s5.addText(results.mine.verdict||'', { x:3.42, y:1.22, w:4.0, h:0.42, fontSize:9, fontFace:'Calibri', bold:true, color:C.offwh, align:'center', valign:'middle', margin:0 });
    if (results.mine.postsAnalyzed>0) {
      s5.addShape(pres.shapes.RECTANGLE, { x:7.54, y:1.22, w:2.2, h:0.42, fill:{color:C.ac+'33'}, line:{color:C.ac} });
      s5.addText(`${results.mine.postsAnalyzed} Reddit posts`, { x:7.54, y:1.22, w:2.2, h:0.42, fontSize:8, fontFace:'Calibri', color:C.ac, align:'center', valign:'middle', margin:0 });
    }

    // Key quotes — show ALL (up to 12) in 2 columns
    lbl(s5, 0.5, 1.82, 12.3, 'Key Quotes from Community');
    const quotes = results.mine.keyQuotes||[];
    const col1 = quotes.slice(0, Math.ceil(quotes.length/2));
    const col2 = quotes.slice(Math.ceil(quotes.length/2));
    const qh = Math.min(0.62, (5.1/Math.max(col1.length,1)));

    col1.forEach((q, i) => {
      const y = 2.12+(i*qh);
      s5.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:6.1, h:qh-0.06, fill:{color:C.coal}, line:{color:C.steel} });
      s5.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:0.06, h:qh-0.06, fill:{color:C.ac}, line:{color:C.ac} });
      s5.addText(`${String(i+1).padStart(2,'0')}`, { x:0.62, y, w:0.32, h:qh-0.06, fontSize:7, fontFace:'Calibri', color:C.muted, valign:'middle', margin:0 });
      s5.addText(`"${q}"`, { x:0.96, y, w:5.5, h:qh-0.06, fontSize:9, fontFace:'Georgia', italic:true, color:C.offwh, wrap:true, valign:'middle', margin:2 });
    });
    col2.forEach((q, i) => {
      const y = 2.12+(i*qh);
      s5.addShape(pres.shapes.RECTANGLE, { x:6.72, y, w:6.08, h:qh-0.06, fill:{color:C.coal}, line:{color:C.steel} });
      s5.addShape(pres.shapes.RECTANGLE, { x:6.72, y, w:0.06, h:qh-0.06, fill:{color:C.ac}, line:{color:C.ac} });
      s5.addText(`${String(col1.length+i+1).padStart(2,'0')}`, { x:6.84, y, w:0.32, h:qh-0.06, fontSize:7, fontFace:'Calibri', color:C.muted, valign:'middle', margin:0 });
      s5.addText(`"${q}"`, { x:7.18, y, w:5.5, h:qh-0.06, fontSize:9, fontFace:'Georgia', italic:true, color:C.offwh, wrap:true, valign:'middle', margin:2 });
    });

    // Confirmation paragraph
    s5.addShape(pres.shapes.RECTANGLE, { x:0.5, y:7.12, w:12.3, h:0.0, fill:{color:C.steel}, line:{color:C.steel} });

    // Product mentions
    lbl(s5, 0.5, 7.2, 12.3, 'Product Mentions');
    // (below — but slide is tall, so product mentions go on next half)
  }

  // SLIDE 5b — Product Mentions (continuation)
  if (results.mine) {
    const s5b = pres.addSlide();
    s5b.background = { color:C.ink };
    hdr(s5b, 'Product Mentions', 'Brand gap confirmation');

    // Confirmation
    quote(s5b, 0.5, 1.22, 12.3, 0.82, results.mine.confirmation||'', 11);

    lbl(s5b, 0.5, 2.18, 12.3, 'Generic Language — No Brand Owns This');
    (results.mine.productMentions||[]).slice(0,4).forEach((p, i) => {
      const y = 2.5+(i*1.18);
      s5b.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:12.3, h:1.08, fill:{color:i===0?C.dark:C.coal}, line:{color:C.steel}, shadow:soft() });
      // Brand awareness badge
      const baC = p.brandAwareness==='NONE'?'16a34a':p.brandAwareness==='LOW'?C.ac:'d97706';
      s5b.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:0.12, h:1.08, fill:{color:baC}, line:{color:baC} });
      s5b.addText(p.product||'', { x:0.78, y:y+0.1, w:5.5, h:0.45, fontSize:15, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
      s5b.addShape(pres.shapes.RECTANGLE, { x:6.4, y:y+0.12, w:2.2, h:0.32, fill:{color:baC+'33'}, line:{color:baC} });
      s5b.addText(`brand: ${p.brandAwareness}`, { x:6.4, y:y+0.12, w:2.2, h:0.32, fontSize:8, fontFace:'Calibri', color:baC.length===6?C.white:C.white, align:'center', valign:'middle', margin:0 });
      s5b.addShape(pres.shapes.RECTANGLE, { x:8.8, y:y+0.12, w:2.0, h:0.32, fill:{color:C.ghost}, line:{color:C.steel} });
      s5b.addText(`intent: ${p.buyingIntent}`, { x:8.8, y:y+0.12, w:2.0, h:0.32, fontSize:8, fontFace:'Calibri', color:C.offwh, align:'center', valign:'middle', margin:0 });
      s5b.addShape(pres.shapes.RECTANGLE, { x:11.0, y:y+0.12, w:1.65, h:0.32, fill:{color:C.ghost}, line:{color:C.steel} });
      s5b.addText(`${p.mentionCount}× mentioned`, { x:11.0, y:y+0.12, w:1.65, h:0.32, fontSize:8, fontFace:'Calibri', color:C.muted, align:'center', valign:'middle', margin:0 });
      s5b.addText(`"${p.genericLanguage}"`, { x:0.78, y:y+0.62, w:11.8, h:0.38, fontSize:9, fontFace:'Calibri', italic:true, color:C.muted, margin:0 });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 7 — VALIDATION
  // ════════════════════════════════════════════════════════════════════════════
  if (results.validate) {
    const s6 = pres.addSlide();
    s6.background = { color:C.ink };
    hdr(s6, 'Validation', 'Timing + Pricing');

    // 3 hero cards
    const vCards = [
      ['DIFFUSION STAGE', results.validate.diffusionStage||'—', {ac:true, fs:18}],
      ['TIMING',          results.validate.trendStatus||'—',    {fs:16}],
      ['CONFIDENCE',      `${results.validate.confidence||'—'}/10`, {fs:22}],
    ];
    vCards.forEach(([k,v,o], i) => card(s6, 0.5+(i*4.1), 1.22, 3.9, 1.05, v, k, o));

    // Data table rows
    const rows = [
      ['Trend',        results.validate.trendStatus],
      ['Momentum',     results.validate.trendMomentum],
      ['Saturation',   results.validate.brandSaturation],
      ['Retail Price', results.validate.suggestedRetailPrice],
      ['Cost to Make', results.validate.costToManufacture],
      ['Gross Margin', results.validate.grossMarginPotential],
    ];
    rows.forEach(([k,v], i) => {
      const y = 2.48+(i*0.55);
      s6.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:12.3, h:0.48, fill:{color:i%2===0?C.coal:C.dark}, line:{color:C.steel} });
      s6.addText(k.toUpperCase(), { x:0.7, y, w:3.5, h:0.48, fontSize:9, fontFace:'Calibri', color:C.muted, valign:'middle', charSpacing:1, margin:0 });
      const isPrice = k.includes('Price')||k.includes('Make')||k.includes('Margin');
      s6.addText(String(v||'—'), { x:4.2, y, w:8.4, h:0.48, fontSize:12, fontFace:isPrice?'Georgia':'Calibri', bold:isPrice, color:isPrice?C.ac:C.offwh, valign:'middle', margin:0 });
    });

    // Window of opportunity
    if (results.validate.windowOfOpportunity) {
      s6.addShape(pres.shapes.RECTANGLE, { x:0.5, y:5.84, w:12.3, h:0.82, fill:{color:C.dark}, line:{color:C.ac} });
      rule(s6, 0.5, 5.84, 12.3);
      lbl(s6, 0.7, 5.92, 3, 'Window of Opportunity', C.ac);
      s6.addText(results.validate.windowOfOpportunity, { x:0.7, y:6.22, w:11.9, h:0.38, fontSize:13, fontFace:'Georgia', italic:true, color:C.offwh, wrap:true, margin:0 });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 8 — THE TRIBE (AVATAR)
  // ════════════════════════════════════════════════════════════════════════════
  if (results.avatar) {
    const s7 = pres.addSlide();
    s7.background = { color:C.ink };
    hdr(s7, 'The Tribe', results.avatar.tribeLabel||'');

    // Persona name + age
    s7.addText(results.avatar.personaName||'', { x:0.5, y:1.18, w:7.5, h:0.78, fontSize:36, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
    s7.addText(results.avatar.age ? `${results.avatar.age}  ·  ${results.avatar.coreIdentity||''}` : results.avatar.coreIdentity||'', {
      x:0.5, y:1.98, w:7.5, h:0.38, fontSize:12, fontFace:'Calibri', color:C.muted, margin:0
    });

    // Tribal essence quote
    quote(s7, 0.5, 2.48, 7.5, 0.82, results.avatar.tribalEssence||'', 11);

    // Identity keyword pills
    lbl(s7, 0.5, 3.45, 7.5, 'Identity Keywords');
    (results.avatar.identityKeywords||[]).slice(0,6).forEach((kw, i) => {
      const col=i%3, row=Math.floor(i/3);
      const x=0.5+(col*2.52), y=3.78+(row*0.62);
      s7.addShape(pres.shapes.RECTANGLE, { x, y, w:2.38, h:0.48, fill:{color:C.dark}, line:{color:C.steel} });
      s7.addText(kw, { x, y, w:2.38, h:0.48, fontSize:10, fontFace:'Calibri', color:C.offwh, align:'center', valign:'middle', margin:0 });
    });

    // YouTube title patterns
    lbl(s7, 0.5, 5.1, 7.5, 'YouTube Title Patterns They Create');
    (results.avatar.youtubeTitlePatterns||[]).slice(0,3).forEach((pat, i) => {
      s7.addShape(pres.shapes.RECTANGLE, { x:0.5, y:5.4+(i*0.62), w:7.5, h:0.52, fill:{color:C.coal}, line:{color:C.steel} });
      s7.addText(pat, { x:0.7, y:5.4+(i*0.62), w:7.2, h:0.52, fontSize:10, fontFace:'Calibri', color:C.offwh, valign:'middle', margin:0 });
    });

    // Right panel — pain points etc
    s7.addShape(pres.shapes.RECTANGLE, { x:8.25, y:1.18, w:4.75, h:6.05, fill:{color:C.coal}, line:{color:C.steel} });
    rule(s7, 8.25, 1.18, 4.75);

    const avRows = [
      ['Aspiration',   results.avatar.aspirationalSelf],
      ['Pain Point',   results.avatar.painPoint],
      ['Wants to Feel',results.avatar.whatTheyWantToFeel],
      ['Brand Killer', results.avatar.whatRepelsThem],
      ['Product Role', results.avatar.productRole],
    ];
    avRows.forEach(([k,v], i) => {
      const y = 1.38+(i*1.12);
      lbl(s7, 8.42, y, 4.4, k, C.ac);
      body(s7, 8.42, y+0.3, 4.4, 0.72, v||'—', 9.5, C.offwh);
      if (i<4) div(s7, 8.42, y+1.06, 4.4);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 9 — BRAND RESEARCH
  // ════════════════════════════════════════════════════════════════════════════
  if (results.brands) {
    const s8 = pres.addSlide();
    s8.background = { color:C.ink };
    hdr(s8, 'Inspiration Brands', 'Same avatar · Different category');

    (results.brands.inspirationBrands||[]).slice(0,3).forEach((b, i) => {
      const bx = 0.5+(i*4.28);
      s8.addShape(pres.shapes.RECTANGLE, { x:bx, y:1.18, w:4.0, h:4.75, fill:{color:C.coal}, line:{color:C.steel}, shadow:elev() });
      rule(s8, bx, 1.18, 4.0);
      s8.addText(b.brand||'', { x:bx+0.2, y:1.32, w:2.8, h:0.62, fontSize:22, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
      // Visual keyword badge
      if (b.visualKeyword) {
        s8.addShape(pres.shapes.RECTANGLE, { x:bx+3.1, y:1.38, w:0.72, h:0.35, fill:{color:C.ac+'44'}, line:{color:C.ac} });
        s8.addText(b.visualKeyword, { x:bx+3.1, y:1.38, w:0.72, h:0.35, fontSize:7, fontFace:'Calibri', color:C.ac, align:'center', valign:'middle', margin:0 });
      }
      s8.addText((b.category||'').toUpperCase(), { x:bx+0.2, y:1.96, w:3.6, h:0.25, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, margin:0 });
      div(s8, bx+0.2, 2.24, 3.6);
      lbl(s8, bx+0.2, 2.38, 3.6, 'Why Same Avatar', C.ac);
      body(s8, bx+0.2, 2.68, 3.6, 1.35, b.whySameAvatar||'', 9.5, C.offwh);
      // Color swatches
      lbl(s8, bx+0.2, 4.08, 3.6, 'Palette');
      (b.colorPalette||[]).slice(0,4).forEach((hex, ci) => {
        s8.addShape(pres.shapes.OVAL, { x:bx+0.2+(ci*0.72), y:4.35, w:0.52, h:0.52, fill:{color:hex.replace('#','')}, line:{color:C.steel} });
      });
      s8.addText('Revenue: '+(b.revenueSignal||'—'), { x:bx+0.2, y:4.98, w:3.6, h:0.28, fontSize:8, fontFace:'Calibri', bold:true, color:C.muted, margin:0 });
    });

    // Photography brief + model direction — full width at bottom
    s8.addShape(pres.shapes.RECTANGLE, { x:0.5, y:6.08, w:12.3, h:1.18, fill:{color:C.dark}, line:{color:C.steel} });
    rule(s8, 0.5, 6.08, 12.3);
    lbl(s8, 0.7, 6.18, 5.5, 'Photography Brief');
    body(s8, 0.7, 6.45, 5.8, 0.72, results.brands.photographyBrief||'', 8.5, C.offwh);
    div(s8, 6.6, 6.18, 0.012);
    lbl(s8, 6.7, 6.18, 5.9, 'Model Direction');
    body(s8, 6.7, 6.45, 5.9, 0.72, results.brands.modelDirection||'', 8.5, C.offwh);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 10 — BRAND IDENTITY
  // ════════════════════════════════════════════════════════════════════════════
  if (results.brand) {
    const s9 = pres.addSlide();
    s9.background = { color:C.ink };

    // Full left panel in brand's primary color
    s9.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:8.5, h:H, fill:{color:C.p1||C.ink}, line:{color:C.p1||C.ink} });
    s9.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.28, h:H, fill:{color:C.ac}, line:{color:C.ac} });

    // Brand name massive
    s9.addText(brand.toUpperCase(), { x:0.55, y:0.55, w:7.7, h:2.8, fontSize:74, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
    s9.addText(`"${results.brand.tagline||''}"`, { x:0.55, y:3.48, w:7.7, h:0.62, fontSize:17, fontFace:'Georgia', italic:true, color:C.muted, margin:0 });
    rule(s9, 0.55, 4.18, 7.5);
    body(s9, 0.55, 4.3, 7.5, 0.72, results.brand.brandPromise||'', 11, C.offwh);

    // Color swatches
    lbl(s9, 0.55, 5.18, 5, 'Color Palette', C.muted);
    Object.entries(pal).forEach(([k,v], i) => {
      const hex=(v||'').replace('#','');
      s9.addShape(pres.shapes.RECTANGLE, { x:0.55+(i*1.08), y:5.48, w:0.88, h:0.88, fill:{color:hex}, line:{color:C.steel}, shadow:soft() });
      s9.addText(v||'', { x:0.55+(i*1.08), y:6.38, w:0.88, h:0.22, fontSize:5.5, fontFace:'Calibri', color:C.muted, align:'center', margin:0 });
    });

    // Brand voice
    s9.addShape(pres.shapes.RECTANGLE, { x:0.55, y:6.72, w:4.5, h:0.45, fill:{color:C.ac}, line:{color:C.ac} });
    s9.addText(`Voice: ${results.brand.brandVoice||''}`, { x:0.55, y:6.72, w:4.5, h:0.45, fontSize:10, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });

    // Right panel
    s9.addShape(pres.shapes.RECTANGLE, { x:8.5, y:0, w:W-8.5, h:H, fill:{color:C.coal}, line:{color:C.steel} });
    rule(s9, 8.5, 0, W-8.5);

    lbl(s9, 8.7, 0.38, 4.4, 'Hero Website Copy', C.muted);
    s9.addText(results.brand.websiteHeroHeadline||'', { x:8.7, y:0.72, w:4.4, h:1.05, fontSize:19, fontFace:'Georgia', bold:true, color:C.white, wrap:true, margin:0 });
    body(s9, 8.7, 1.82, 4.4, 0.72, results.brand.websiteHeroSubline||'', 10, C.muted);
    s9.addShape(pres.shapes.RECTANGLE, { x:8.7, y:2.62, w:2.5, h:0.48, fill:{color:C.ac}, line:{color:C.ac} });
    s9.addText(results.brand.ctaText||'SHOP NOW', { x:8.7, y:2.62, w:2.5, h:0.48, fontSize:10, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });

    div(s9, 8.7, 3.28, 4.4);
    lbl(s9, 8.7, 3.42, 4.4, 'Name Options', C.muted);
    (results.brand.nameOptions||[]).slice(0,3).forEach((n, i) => {
      const y = 3.75+(i*1.12);
      const isW = n.name===brand;
      s9.addShape(pres.shapes.RECTANGLE, { x:8.7, y, w:4.4, h:1.0, fill:{color:isW?C.ac+'22':C.dark}, line:{color:isW?C.ac:C.steel} });
      s9.addText(n.name||'', { x:8.88, y:y+0.08, w:3.2, h:0.42, fontSize:17, fontFace:'Georgia', bold:true, color:isW?C.ac:C.white, margin:0 });
      if (isW) s9.addText('✓', { x:11.88, y:y+0.08, w:0.55, h:0.42, fontSize:14, fontFace:'Georgia', bold:true, color:C.ac, align:'center', margin:0 });
      body(s9, 8.88, y+0.52, 4.1, 0.38, n.aspirationalQuality||'', 8.5, C.muted);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 11 — WEBSITE BRIEF
  // ════════════════════════════════════════════════════════════════════════════
  if (results.shopify) {
    const s10 = pres.addSlide();
    s10.background = { color:C.ink };
    hdr(s10, 'Website Brief', results.shopify.domain||'');

    // Domain + Theme
    s10.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.18, w:12.3, h:0.62, fill:{color:C.dark}, line:{color:C.steel} });
    s10.addText('DOMAIN', { x:0.7, y:1.18, w:1.5, h:0.62, fontSize:7, fontFace:'Calibri', color:C.muted, valign:'middle', charSpacing:2, margin:0 });
    s10.addText(results.shopify.domain||'', { x:2.2, y:1.18, w:3.0, h:0.62, fontSize:13, fontFace:'Georgia', bold:true, color:C.ac, valign:'middle', margin:0 });
    s10.addText('THEME', { x:5.3, y:1.18, w:1.2, h:0.62, fontSize:7, fontFace:'Calibri', color:C.muted, valign:'middle', charSpacing:2, margin:0 });
    body(s10, 6.5, 1.18, 6.3, 0.62, results.shopify.shopifyTheme||'', 9, C.offwh);

    // Hero section mock
    s10.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.98, w:7.8, h:2.95, fill:{color:C.coal}, line:{color:C.steel}, shadow:elev() });
    rule(s10, 0.5, 1.98, 7.8);
    lbl(s10, 0.7, 2.1, 6, 'Hero Section', C.muted);
    s10.addText(results.shopify.heroSection?.headline||'', { x:0.7, y:2.42, w:7.4, h:0.88, fontSize:22, fontFace:'Georgia', bold:true, color:C.white, wrap:true, margin:0 });
    body(s10, 0.7, 3.38, 7.4, 0.58, results.shopify.heroSection?.subline||'', 10, C.muted);
    s10.addShape(pres.shapes.RECTANGLE, { x:0.7, y:4.05, w:2.2, h:0.48, fill:{color:C.ac}, line:{color:C.ac} });
    s10.addText(results.shopify.heroSection?.cta||'SHOP NOW', { x:0.7, y:4.05, w:2.2, h:0.48, fontSize:10, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });

    // Navigation
    lbl(s10, 0.5, 5.08, 7.8, 'Navigation');
    (results.shopify.navigation||[]).forEach((nav, i) => {
      s10.addShape(pres.shapes.RECTANGLE, { x:0.5+(i*2.0), y:5.38, w:1.85, h:0.42, fill:{color:C.dark}, line:{color:C.steel} });
      s10.addText(nav, { x:0.5+(i*2.0), y:5.38, w:1.85, h:0.42, fontSize:9, fontFace:'Calibri', color:C.offwh, align:'center', valign:'middle', margin:0 });
    });

    // Product description
    s10.addShape(pres.shapes.RECTANGLE, { x:0.5, y:5.95, w:7.8, h:1.32, fill:{color:C.dark}, line:{color:C.steel} });
    lbl(s10, 0.7, 6.05, 6, 'Product Description — Identity First', C.ac);
    body(s10, 0.7, 6.35, 7.4, 0.85, results.shopify.productDescription||'', 9.5, C.offwh);

    // Right panel
    s10.addShape(pres.shapes.RECTANGLE, { x:8.55, y:1.98, w:4.45, h:5.29, fill:{color:C.coal}, line:{color:C.steel} });
    rule(s10, 8.55, 1.98, 4.45);

    [
      ['Upsell Logic',    results.shopify.upsellLogic],
      ['Email Capture',   results.shopify.emailCaptureIdea],
      ['SEO Title',       results.shopify.seoTitle],
      ['SEO Description', results.shopify.seoDescription],
    ].forEach(([k,v], i) => {
      const y = 2.12+(i*1.25);
      lbl(s10, 8.72, y, 4.1, k, C.ac);
      body(s10, 8.72, y+0.3, 4.1, 0.85, v||'—', 9, C.offwh);
      if (i<3) div(s10, 8.72, y+1.18, 4.1);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 12 — CONTENT STRATEGY
  // ════════════════════════════════════════════════════════════════════════════
  if (results.content) {
    const s11 = pres.addSlide();
    s11.background = { color:C.ink };
    hdr(s11, 'Content Strategy', '30-second reveal formula');

    const hero   = results.content.heroScript||{};
    const stitch = results.content.stitchVideo||{};
    const ret    = results.content.retargetingAd||{};

    // Left — stitch video (STEP 1)
    s11.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.18, w:6.1, h:2.28, fill:{color:C.coal}, line:{color:C.steel}, shadow:soft() });
    rule(s11, 0.5, 1.18, 6.1);
    s11.addText('STEP 1  ·  STITCH VIDEO', { x:0.7, y:1.28, w:5.7, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, margin:0 });
    lbl(s11, 0.7, 1.62, 5.7, 'Search For', C.ac);
    s11.addText(stitch.findQuery||'', { x:0.7, y:1.92, w:5.7, h:0.5, fontSize:14, fontFace:'Georgia', bold:true, color:C.white, wrap:true, margin:0 });
    lbl(s11, 0.7, 2.48, 5.7, 'Why It Works', C.muted);
    body(s11, 0.7, 2.78, 5.7, 0.6, stitch.whyItWorks||'', 9.5, C.offwh);

    // Left — hero script (STEP 2)
    s11.addShape(pres.shapes.RECTANGLE, { x:0.5, y:3.62, w:6.1, h:3.62, fill:{color:C.coal}, line:{color:C.steel}, shadow:soft() });
    rule(s11, 0.5, 3.62, 6.1);
    s11.addText('STEP 2  ·  HERO SCRIPT', { x:0.7, y:3.72, w:5.7, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, margin:0 });

    const scriptRows = [
      ['Hook  0–3s',      hero.hook_0_3s,    C.white,  false],
      ['Setup  3–30s',    hero.setup_3_30s,  C.offwh,  false],
      ['⚡ 30s Reveal',   hero.reveal_30s,   C.ac,     true ],
      ['CTA  30–60s',     hero.cta_30_60s,   C.offwh,  false],
    ];
    scriptRows.forEach(([lk, val, vc, isH], j) => {
      const y = 4.08+(j*0.82);
      if (isH) s11.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:6.1, h:0.72, fill:{color:C.ac+'1A'}, line:{color:C.ac+'55'} });
      s11.addText(lk, { x:0.7, y:y+0.02, w:5.7, h:0.22, fontSize:6.5, fontFace:'Calibri', color:isH?C.ac:C.muted, charSpacing:2, margin:0 });
      body(s11, 0.7, y+0.24, 5.7, 0.48, val||'', 9, vc);
    });

    // Viral mechanic
    s11.addShape(pres.shapes.RECTANGLE, { x:0.5, y:7.1, w:6.1, h:0.0, fill:{color:C.steel}, line:{color:C.steel} });

    // Right — retargeting (STEP 3)
    s11.addShape(pres.shapes.RECTANGLE, { x:6.85, y:1.18, w:6.15, h:3.58, fill:{color:C.ink}, line:{color:C.ac}, shadow:glow() });
    rule(s11, 6.85, 1.18, 6.15);
    s11.addText('STEP 3  ·  RETARGETING AD  (50%+ viewers)', { x:7.05, y:1.28, w:5.75, h:0.28, fontSize:7, fontFace:'Calibri', color:C.muted, charSpacing:2, margin:0 });
    s11.addText(ret.headline||'', { x:7.05, y:1.65, w:5.75, h:0.98, fontSize:18, fontFace:'Georgia', bold:true, color:C.white, wrap:true, margin:0 });
    body(s11, 7.05, 2.72, 5.75, 1.0, ret.body||'', 10, C.offwh);
    s11.addShape(pres.shapes.RECTANGLE, { x:7.05, y:3.88, w:2.4, h:0.48, fill:{color:C.ac}, line:{color:C.ac} });
    s11.addText(ret.cta||'SHOP NOW', { x:7.05, y:3.88, w:2.4, h:0.48, fontSize:10, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });

    // Why it spreads
    s11.addShape(pres.shapes.RECTANGLE, { x:6.85, y:4.92, w:6.15, h:2.32, fill:{color:C.dark}, line:{color:C.steel} });
    lbl(s11, 7.05, 5.05, 5.75, 'Why It Spreads', C.ac);
    body(s11, 7.05, 5.35, 5.75, 1.8, hero.viralMechanic||'', 10, C.offwh);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 13 — SUPPLIER PACK
  // ════════════════════════════════════════════════════════════════════════════
  if (results.supplier) {
    const s12 = pres.addSlide();
    s12.background = { color:C.ink };
    hdr(s12, 'Supplier Pack', 'China sourcing brief');

    const spec = results.supplier.factorySpec||results.supplier.manufacturingBrief||{};
    const bud  = results.supplier.budget||results.supplier.estimatedBudget||{};

    // Sourcing region
    s12.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.18, w:12.3, h:0.85, fill:{color:C.dark}, line:{color:C.steel} });
    rule(s12, 0.5, 1.18, 12.3);
    lbl(s12, 0.7, 1.28, 2.5, 'Best Sourcing Region', C.ac);
    body(s12, 0.7, 1.55, 11.9, 0.42, results.supplier.sourcingRegion||'', 10, C.offwh);

    // Factory spec cards
    const specCards = [
      ['MOQ',       spec.moq,        {}],
      ['COGS',      spec.targetCOGS, {ac:true}],
      ['MARGIN',    spec.margin,     {}],
      ['LEAD TIME', spec.leadTime,   {}],
    ];
    specCards.forEach(([k,v,o], i) => card(s12, 0.5+(i*3.1), 2.18, 2.9, 0.92, v, k, {...o, fs:18}));

    // Materials
    s12.addShape(pres.shapes.RECTANGLE, { x:0.5, y:3.25, w:12.3, h:0.78, fill:{color:C.coal}, line:{color:C.steel} });
    lbl(s12, 0.7, 3.32, 2.5, 'Materials', C.ac);
    body(s12, 0.7, 3.58, 11.9, 0.38, spec.materials||spec.qualityDifferentiator||'', 9, C.offwh);

    // Alibaba terms
    lbl(s12, 0.5, 4.18, 12.3, 'Alibaba Search Terms');
    (results.supplier.alibabaTerms||[]).slice(0,5).forEach((t, i) => {
      s12.addShape(pres.shapes.RECTANGLE, { x:0.5+(i*2.48), y:4.48, w:2.32, h:0.42, fill:{color:C.dark}, line:{color:C.steel} });
      s12.addText(t, { x:0.5+(i*2.48), y:4.48, w:2.32, h:0.42, fontSize:8.5, fontFace:'Calibri', color:C.offwh, align:'center', valign:'middle', wrap:true, margin:3 });
    });

    // Sample checklist
    lbl(s12, 0.5, 5.05, 6.0, 'Sample Checklist');
    (results.supplier.sampleChecklist||[]).slice(0,4).forEach((item, i) => {
      const y = 5.35+(i*0.5);
      s12.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:6.0, h:0.42, fill:{color:C.coal}, line:{color:C.steel} });
      s12.addShape(pres.shapes.RECTANGLE, { x:0.5, y, w:0.35, h:0.42, fill:{color:'16a34a'}, line:{color:'16a34a'} });
      s12.addText('✓', { x:0.5, y, w:0.35, h:0.42, fontSize:9, fontFace:'Calibri', bold:true, color:C.white, align:'center', valign:'middle', margin:0 });
      body(s12, 0.92, y, 5.5, 0.42, item, 8.5, C.offwh);
    });

    // Budget
    lbl(s12, 6.72, 5.05, 5.95, 'Launch Budget');
    const budEntries = Object.entries(bud);
    budEntries.forEach(([k,v], i) => {
      const isT = k==='total';
      const x = 6.72+(i*(5.95/Math.max(budEntries.length,1)));
      const w = (5.95/Math.max(budEntries.length,1))-0.12;
      card(s12, x, 5.35, w, 1.55, v, k.toUpperCase(), {ac:isT, fs:isT?20:16});
    });

    // Outreach message
    lbl(s12, 0.5, 7.42, 12.3, 'Copy-Paste Outreach Message');
  }

  // SLIDE 12b — Outreach message full
  if (results.supplier?.outreachMessage) {
    const s12b = pres.addSlide();
    s12b.background = { color:C.ink };
    hdr(s12b, 'Outreach Message', 'Copy and paste — ready to send');

    s12b.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.18, w:12.3, h:5.98, fill:{color:C.coal}, line:{color:C.steel} });
    rule(s12b, 0.5, 1.18, 12.3);
    s12b.addText(results.supplier.outreachMessage||'', {
      x:0.7, y:1.38, w:11.9, h:5.72,
      fontSize:10, fontFace:'Calibri', color:C.offwh,
      wrap:true, valign:'top', margin:0
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 14 — 30-DAY PLAYBOOK
  // ════════════════════════════════════════════════════════════════════════════
  const sLast = pres.addSlide();
  sLast.background = { color:C.ink };
  rule(sLast, 0, 0, W);

  sLast.addText('What Happens Next', { x:0.5, y:0.28, w:12, h:1.15, fontSize:52, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
  sLast.addText('THE 30-DAY LAUNCH PLAYBOOK', { x:0.5, y:1.48, w:12, h:0.32, fontSize:9, fontFace:'Calibri', color:C.muted, charSpacing:4, margin:0 });
  div(sLast, 0.5, 1.88, 12);

  const weeks = [
    ['WEEK 1', 'Manufacturing',   `Contact 20–50 Alibaba suppliers. Use the outreach template verbatim. Budget ~$300–500 for samples. Evaluate on texture, pH, packaging integrity.`],
    ['WEEK 2', 'Photo Shoot',     `One shoot. Real model. Real location. Identity-first framing — not product hero shots. Shoot 30+ stills + raw B-roll. No studio backdrops.`],
    ['WEEK 3', 'Launch Content',  `Post 3 videos using the 30s reveal formula. Stitch → Hero script → iterate. Zero paid ads. Pure organic. Watch retention graphs at 30s.`],
    ['WEEK 4', 'Retargeting',     `Run static image ads to 50%+ video viewers. Expected CVR 7%+. Test 2 headlines. Scale the winner. Kill the loser on day 3.`],
  ];

  weeks.forEach(([wk, title, desc], i) => {
    const bx = 0.5+(i*3.22);
    sLast.addShape(pres.shapes.RECTANGLE, { x:bx, y:2.12, w:3.0, h:5.1, fill:{color:C.dark}, line:{color:C.steel}, shadow:soft() });
    sLast.addShape(pres.shapes.RECTANGLE, { x:bx, y:2.12, w:3.0, h:0.06, fill:{color:C.ac}, line:{color:C.ac} });
    sLast.addText(wk, { x:bx+0.18, y:2.22, w:2.65, h:0.28, fontSize:7.5, fontFace:'Calibri', color:C.muted, charSpacing:2.5, margin:0 });
    sLast.addText(title, { x:bx+0.18, y:2.55, w:2.65, h:0.62, fontSize:18, fontFace:'Georgia', bold:true, color:C.white, margin:0 });
    div(sLast, bx+0.18, 3.22, 2.65);
    body(sLast, bx+0.18, 3.38, 2.65, 2.85, desc, 9.5, C.offwh);
    sLast.addText(String(i+1), { x:bx+0.18, y:5.72, w:2.65, h:1.28, fontSize:64, fontFace:'Georgia', bold:true, color:C.ghost, margin:0 });
  });

  await pres.writeFile({ fileName:`${brand}-Brand-Report.pptx` });
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase]         = useState("idle");
  const [market, setMarket]       = useState("");
  const [screen, setScreen]       = useState("agent");
  const [stMap, setStMap]         = useState({});
  const [results, setResults]     = useState({});
  const [tab, setTab]             = useState(null);
  const [log, setLog]             = useState([]);
  const [exporting, setExporting] = useState(false);
  const logRef = useRef(null);

  const addLog = msg => {
    setLog(p => [...p.slice(-80), msg]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  };
  const setSt  = (id, s) => setStMap(p => ({ ...p, [id]: s }));
  const setRes = (id, d) => { setResults(p => ({ ...p, [id]: d })); setTab(id); };
  const reset  = () => { setPhase("idle"); setStMap({}); setResults({}); setTab(null); setLog([]); };

  const run = useCallback(async (parentMarket) => {
    setPhase("running");

   const go = async (id, prompt, msg, maxTokens = 2000) => {
  setSt(id, "running"); addLog(msg);
  const d = await callClaude(prompt, undefined, maxTokens);
      if (d._error) { setSt(id, "error"); addLog(`Failed: ${d._error}`); return null; }
      setRes(id, d); setSt(id, "done"); addLog(`Done`);
      await sleep(1000); return d;
    };

   try {
  let prevGaps = [];
  try {
    const histRes = await fetch('/api/history');
    const histData = await histRes.json();
    prevGaps = (histData.runs || []).map(h => h.results?.gap?.winnerProduct).filter(Boolean);
  } catch { prevGaps = []; }
  const gap = await go("gap", P.gap(parentMarket, prevGaps), `Scanning "${parentMarket}" for brand gaps…`);
  if (!gap) { setPhase("idle"); addLog(`Try a more specific market — e.g. pilates, golf, skincare`); return; }
  addLog(`Found: ${gap.winnerProduct} in ${gap.winnerSubCommunity}`);

      setSt("youtube", "running");
      addLog(`Fetching YouTube transcripts…`);
      const ytData = await fetchYouTube(gap.youtubeSearchTerm);
      if (ytData?.videosWithTranscripts) { setRes("youtube", ytData); setSt("youtube", "done"); addLog(`${ytData.videosWithTranscripts} transcripts extracted`); }
      else { setSt("youtube", "error"); addLog(`YouTube transcripts unavailable`); }
      await sleep(500);
      
      setSt("reddit", "running");
      addLog(`Fetching Reddit discussions…`);
      const redditData = await fetchReddit(gap.winnerProduct, gap.winnerSubCommunity);
      if (redditData?.postsFound) { setRes("reddit", redditData); setSt("reddit", "done"); addLog(`${redditData.postsFound} Reddit posts found`); }
      else { setSt("reddit", "error"); addLog(`Reddit unavailable — simulating`); }
      await sleep(500);
      
      setSt("trends", "running"); addLog(`Fetching Google Trends…`);
      addLog(`Trends params: ${parentMarket} | ${gap.winnerSubCommunity} | ${parentMarket + ' ' + gap.winnerSubCommunity}`);
      const trendsData = await fetchTrends(parentMarket, gap.winnerSubCommunity, parentMarket + ' ' + gap.winnerSubCommunity);
      addLog(`Trends raw: ${JSON.stringify(trendsData)?.slice(0, 100)}`);
      if (trendsData && !trendsData.error) { setRes("trends", trendsData); setSt("trends", "done"); addLog(`${trendsData.trend?.direction} · ${trendsData.interpretation?.momentum}`); }
      else { setSt("trends", "error"); addLog(`Trends API unavailable — simulating`); }
      await sleep(1000);
      
     const mine = await go("mine", P.mine(gap.winnerSubCommunity, gap.winnerProduct, ytData, redditData), `Analyzing community data…`);
      if (!mine) { setPhase("done"); return; }

      const val = await go("validate", P.validate(gap.winnerProduct, gap.winnerSubCommunity, trendsData), `Validating with trends data…`);
      if (!val) { setPhase("done"); return; }

      const av = await go("avatar", P.avatar(gap.winnerSubCommunity, gap.winnerProduct), `Mapping the tribe…`);
      if (!av) { setPhase("done"); return; }

      const br = await go("brands", P.brandResearch(av.personaName, av.coreIdentity, av.tribeLabel), `Finding the Glossier equivalent…`);
      if (!br) { setPhase("done"); return; }

      const id = await go("brand", P.brand(gap.winnerProduct, gap.winnerSubCommunity, av.coreIdentity, br.overallAestheticDirection), `Building brand identity…`);
      if (!id) { setPhase("done"); return; }
      addLog(`${id.winner} — "${id.tagline}"`);

      const sh = await go("shopify", P.shopify(id.winner, gap.winnerProduct, gap.winnerSubCommunity, av.personaName), `Writing website brief…`);
      if (!sh) { setPhase("done"); return; }

      const ct = await go("content", P.content(id.winner, gap.winnerProduct, gap.winnerSubCommunity, av.personaName, av.coreIdentity), `Writing viral scripts…`, 1000);
      if (!ct) { setPhase("done"); return; }

      const su = await go("supplier", P.supplier(id.winner, gap.winnerProduct, gap.winnerSubCommunity, val.suggestedRetailPrice), `Building supplier pack…`, 1000);
      if (!su) { setPhase("done"); return; }

      addLog(`Complete — ${id.winner} is ready`);

      try {
        await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            results: { gap, mine, validate: val, avatar: av, brands: br, brand: id, shopify: sh, content: ct, supplier: su },
            market: parentMarket
          })
        });
        addLog(`Saved to history`);
      } catch (e) { addLog(`Save failed: ${e.message}`); }

      setPhase("done");
    } catch (e) { addLog(`Error: ${e.message}`); setPhase("done"); }
  }, []);

  const exportPPT = async () => {
    setExporting(true);
    try { await generatePPT(results, market); }
    catch (e) { alert("Export failed: " + e.message); }
    finally { setExporting(false); }
  };

  const doneCount = Object.values(stMap).filter(s => s === "done").length;
  const allDone   = !!results.supplier;
  const pct       = (doneCount / STAGES.length) * 100;
  const brandName = results.brand?.winner;
  const Panel     = tab ? Panels[tab] : null;
  const stage     = tab ? STAGES.find(s => s.id === tab) : null;
 const EXAMPLES = ["fitness", "pilates", "golf", "skincare", "haircare", "running", "cycling", "hiking", "tennis", "padel", "pickleball", "matcha", "coffee", "nutrition", "gut health", "meditation", "sleep", "journaling", "dogs", "baby", "men's grooming", "camping", "climbing"];

  return (
    <div style={{ minHeight: "100vh", background: "var(--white)", color: "var(--gray-900)", fontFamily: "var(--font-sans)" }}>
      <style>{FONTS + CSS}</style>

      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        height: 52, borderBottom: "1px solid var(--gray-200)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(12px)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 24, height: 24, background: "var(--gray-900)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: "white" }}>◎</span>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Brand Gap</span>
          <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
            {["agent", "history"].map(s => (
              <button key={s} onClick={() => setScreen(s)} style={{
                padding: "4px 12px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500,
                background: screen === s ? "var(--gray-100)" : "transparent",
                color: screen === s ? "var(--gray-900)" : "var(--gray-400)",
                transition: "all 0.15s", textTransform: "capitalize"
              }}>{s}</button>
            ))}
          </div>
          {brandName && screen === "agent" && <>
            <span style={{ color: "var(--gray-300)" }}>·</span>
            <span style={{ fontSize: 13, color: "var(--gray-500)" }}>{brandName}</span>
          </>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {phase === "running" && screen === "agent" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
              <Spin size={12} />
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-500)" }}>{doneCount}/{STAGES.length}</span>
            </div>
          )}
          {allDone && screen === "agent" && (
            <button onClick={exportPPT} disabled={exporting} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
              background: exporting ? "var(--gray-100)" : "var(--gray-900)",
              color: exporting ? "var(--gray-400)" : "white",
              borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500, transition: "all 0.15s"
            }}>
              {exporting ? <><Spin size={12} color="#9ca3af" /> Building…</> : "↓ Download PPT"}
            </button>
          )}
          {phase !== "idle" && screen === "agent" && (
            <button onClick={reset} style={{
              padding: "6px 12px", border: "1px solid var(--gray-200)", color: "var(--gray-500)",
              borderRadius: "var(--radius-sm)", fontSize: 12, transition: "all 0.15s"
            }}
              onMouseEnter={e => e.target.style.borderColor = "var(--gray-400)"}
              onMouseLeave={e => e.target.style.borderColor = "var(--gray-200)"}
            >Reset</button>
          )}
        </div>
      </div>

      {phase !== "idle" && screen === "agent" && (
        <div style={{ height: 2, background: "var(--gray-100)" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--gray-900)", transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
        </div>
      )}

      {screen === "history" && (
        <div style={{ height: "calc(100vh - 52px)", overflowY: "auto", background: "var(--white)" }}>
          <HistoryScreen onViewRun={async (id) => {
            try {
              const res = await fetch(`/api/history?id=${id}`);
              const full = await res.json();
              if (full?.results) {
                setResults(full.results);
                setMarket(full.market);
                const newStMap = {};
                Object.keys(full.results).forEach(k => { newStMap[k] = "done"; });
                setStMap(newStMap);
                setTab("gap");
                setPhase("done");
                setScreen("agent");
              }
            } catch (e) { alert("Failed to load run: " + e.message); }
          }} />
        </div>
      )}

      {screen === "agent" && (
        <>
          {phase === "idle" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "60px 24px" }}>
              <div style={{ maxWidth: 520, width: "100%", animation: "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: 99, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-500)", marginBottom: 28, letterSpacing: "0.04em" }}>
                  <span style={{ width: 6, height: 6, background: "#16a34a", borderRadius: "50%", display: "inline-block" }} />
                  Real YouTube + Google Trends data
                </div>
                <h1 style={{ fontSize: 48, fontFamily: "var(--font-serif)", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--gray-900)", marginBottom: 16 }}>
                  Find where people<br />
                  <span style={{ fontStyle: "italic", color: "var(--gray-400)" }}>already spend,</span><br />
                  but own no brand.
                </h1>
                <p style={{ fontSize: 15, color: "var(--gray-500)", lineHeight: 1.8, marginBottom: 36 }}>
                  Nike owns <em>sports socks</em>. Nobody owns <em>Pilates socks</em>. Same market, billions in spend, zero brand ownership. Type a parent market — the agent finds the gap.
                </p>
                <div style={{ position: "relative", marginBottom: 12 }}>
                  <input
                    value={market}
                    onChange={e => setMarket(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && market.trim() && run(market.trim())}
                    placeholder="fitness, golf, skincare…"
                    style={{
                      width: "100%", padding: "14px 130px 14px 18px",
                      border: "1px solid var(--gray-200)", borderRadius: "var(--radius)",
                      fontSize: 15, color: "var(--gray-900)", background: "var(--white)",
                      outline: "none", boxShadow: "var(--shadow-sm)", transition: "border-color 0.15s, box-shadow 0.15s"
                    }}
                    onFocus={e => { e.target.style.borderColor = "var(--gray-400)"; e.target.style.boxShadow = "0 0 0 3px rgba(0,0,0,0.04)"; }}
                    onBlur={e => { e.target.style.borderColor = "var(--gray-200)"; e.target.style.boxShadow = "var(--shadow-sm)"; }}
                  />
                  <button onClick={() => market.trim() && run(market.trim())} disabled={!market.trim()} style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    padding: "8px 16px", background: market.trim() ? "var(--gray-900)" : "var(--gray-200)",
                    color: market.trim() ? "white" : "var(--gray-400)",
                    borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 500,
                    transition: "all 0.15s", cursor: market.trim() ? "pointer" : "default"
                  }}>Run →</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 40 }}>
                  {EXAMPLES.map(ex => (
                    <button key={ex} onClick={() => setMarket(ex)} style={{
                      padding: "5px 12px", border: "1px solid var(--gray-200)",
                      borderRadius: 99, fontSize: 12, color: "var(--gray-500)", background: "white", transition: "all 0.15s"
                    }}
                      onMouseEnter={e => { e.target.style.borderColor = "var(--gray-400)"; e.target.style.color = "var(--gray-900)"; }}
                      onMouseLeave={e => { e.target.style.borderColor = "var(--gray-200)"; e.target.style.color = "var(--gray-500)"; }}
                    >{ex}</button>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid var(--gray-100)", paddingTop: 28 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
                    {[
                      ["◎", "Brand gap detection", "Scores 5 sub-communities on demand vs saturation"],
                      ["▶", "Real YouTube data", "Actual transcripts from micro-influencers"],
                      ["↗", "Google Trends", "12 months of real search momentum"],
                      ["◆", "Full brand identity", "Name, colors, copy, Shopify brief"],
                      ["✦", "Viral scripts", "30s transition formula + stitch strategy"],
                      ["↓", "PPT report", "Branded deck ready to share"],
                    ].map(([icon, label, desc]) => (
                      <div key={label} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 14, color: "var(--gray-400)", paddingTop: 1, flexShrink: 0 }}>{icon}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-900)", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 12, color: "var(--gray-400)", lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase !== "idle" && (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "calc(100vh - 54px)" }}>
              <div style={{ borderRight: "1px solid var(--gray-200)", display: "flex", flexDirection: "column", background: "var(--gray-50)" }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--gray-200)" }}>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gray-400)", marginBottom: 4, letterSpacing: "0.08em" }}>MARKET</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--gray-900)", letterSpacing: "-0.01em" }}>{market}</div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                  {STAGES.map(s => {
                    const st = stMap[s.id] || "idle";
                    const active = tab === s.id;
                    const clickable = !!results[s.id];
                    return (
                      <button key={s.id} onClick={() => clickable && setTab(s.id)} style={{
                        width: "100%", padding: "8px 14px",
                        background: active ? "var(--white)" : "transparent",
                        borderLeft: `2px solid ${active ? "var(--gray-900)" : "transparent"}`,
                        display: "flex", alignItems: "center", gap: 10,
                        cursor: clickable ? "pointer" : "default", textAlign: "left",
                        transition: "all 0.12s", borderRight: "none", borderTop: "none", borderBottom: "none"
                      }}>
                        <div style={{ width: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {st === "running" && <Spin size={12} color={s.color} />}
                          {st === "done"    && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "block" }} />}
                          {st === "error"   && <span style={{ fontSize: 10, color: "#d97706" }}>~</span>}
                          {st === "idle"    && <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--gray-300)", display: "block" }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 12, fontWeight: 500, marginBottom: 1,
                            color: st === "done" ? (active ? "var(--gray-900)" : "var(--gray-700)") : st === "running" ? "var(--gray-900)" : "var(--gray-400)",
                            display: "flex", alignItems: "center", gap: 5
                          }}>
                            {s.label}
                            {s.isData && st === "done" && <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "#16a34a", background: "#f0fdf4", padding: "1px 5px", borderRadius: 99 }}>real</span>}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gray-400)", lineHeight: 1.3 }}>{s.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {allDone && (
                  <div style={{ borderTop: "1px solid var(--gray-200)", padding: "12px 14px" }}>
                    <button onClick={exportPPT} disabled={exporting} style={{
                      width: "100%", padding: "9px 12px",
                      background: exporting ? "var(--gray-100)" : "var(--gray-900)",
                      color: exporting ? "var(--gray-400)" : "white",
                      borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.15s"
                    }}>
                      {exporting ? <><Spin size={12} color="#9ca3af" /> Building deck…</> : "↓ Download PPT report"}
                    </button>
                  </div>
                )}
                <div style={{ borderTop: "1px solid var(--gray-200)", padding: "10px 14px" }}>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gray-400)", marginBottom: 6, letterSpacing: "0.06em" }}>LOG</div>
                  <div ref={logRef} style={{ maxHeight: 110, overflowY: "auto" }}>
                    {log.map((l, i) => (
                      <div key={i} style={{ fontSize: 10, fontFamily: "var(--font-mono)", lineHeight: 1.6, marginBottom: 1, color: i === log.length - 1 ? "var(--gray-700)" : "var(--gray-400)" }}>
                        {l}{i === log.length - 1 && phase === "running" && <span className="blink" style={{ color: "var(--gray-400)" }}>_</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ overflowY: "auto", background: "var(--white)" }}>
                {!tab && phase === "running" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
                    <Spin size={24} />
                    <div style={{ fontSize: 13, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>Scanning "{market}"</div>
                    <div style={{ fontSize: 12, color: "var(--gray-300)", fontFamily: "var(--font-mono)" }}>click any completed stage to preview</div>
                  </div>
                )}
                {tab && Panel && results[tab] && (
                  <div className="fadeUp" style={{ padding: "32px 40px", maxWidth: 720 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--gray-100)" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 24, fontFamily: "var(--font-serif)", color: "var(--gray-900)", letterSpacing: "-0.01em", marginBottom: 4 }}>{stage?.label}</div>
                        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>{stage?.desc}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 22, fontFamily: "var(--font-serif)", color: "var(--gray-300)" }}>{doneCount}<span style={{ fontSize: 14 }}>/{STAGES.length}</span></div>
                      </div>
                    </div>
                    <Panel d={results[tab]} />
                  </div>
                )}
                {phase === "done" && !tab && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40 }}>
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", letterSpacing: "0.08em", marginBottom: 16 }}>COMPLETE</div>
                    <div style={{ fontSize: 52, fontFamily: "var(--font-serif)", color: "var(--gray-900)", letterSpacing: "-0.02em", marginBottom: 8 }}>{brandName}</div>
                    <p style={{ fontSize: 14, color: "var(--gray-400)", marginBottom: 32 }}>Select any stage from the sidebar to review.</p>
                    <button onClick={exportPPT} disabled={exporting} style={{
                      padding: "12px 28px", background: exporting ? "var(--gray-100)" : "var(--gray-900)",
                      color: exporting ? "var(--gray-400)" : "white",
                      borderRadius: "var(--radius)", fontSize: 14, fontWeight: 500,
                      display: "inline-flex", alignItems: "center", gap: 8,
                      cursor: exporting ? "default" : "pointer", transition: "all 0.15s"
                    }}>
                      {exporting ? <><Spin size={14} color="#9ca3af" /> Building deck…</> : "↓ Download PPT report"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
