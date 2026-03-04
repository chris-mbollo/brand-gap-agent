import { useState, useRef, useCallback, useEffect } from "react";

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

async function callClaude(prompt, system) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
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

async function fetchTrends(q) {
  try {
    const res = await fetch(`/api/trends?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const P = {
  gap: (market) => `Parent market: "${market}". Find the single best brand gap — a sub-community with strong product demand but ZERO brand ownership. The Pilates socks logic: everyone needs them, nobody says "my Brand X grip socks." Evaluate 5 sub-communities. Score on: growth signal + brand saturation (lower = better gap).
Return ONLY JSON: {"parentMarket":"${market}","subCommunities":[{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]}],"winnerSubCommunity":"name","winnerProduct":"specific product","gapScore":9,"whyThisGap":"2 sentences","brandSaturation":"NONE/VERY LOW/LOW","howPeopleReferToIt":"generic phrase","dominantBrands":["none yet"],"parentMarketSize":"$XB","cagr":"X%","youtubeSearchTerm":"exact search term"}`,

  mine: (sub, product, ytData) => ytData?.corpus
    ? `You have REAL YouTube transcript data from ${ytData.videosWithTranscripts} videos in the "${sub}" community.\n\nTranscript corpus:\n---\n${ytData.corpus.slice(0, 18000)}\n---\n\nAnalyze for "${product}" brand gap signals. Find generic language (no brand names), frustration signals, exact phrases people use.\nReturn ONLY JSON: {"transcriptsAnalyzed":${ytData.videosWithTranscripts},"dataSource":"REAL_YOUTUBE","keyQuotes":["exact real quote 1","exact real quote 2","exact real quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"phrase","mentionCount":8,"brandAwareness":"NONE/LOW","buyingIntent":"HIGH/MED/LOW"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":3,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"one sentence based on real data","earlyAdopterProfile":"describe based on actual creators"}`
    : `Analyze the "${sub}" community for "${product}" brand gap signals based on your knowledge.\nReturn ONLY JSON: {"transcriptsAnalyzed":0,"dataSource":"SIMULATED","keyQuotes":["quote 1","quote 2","quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"phrase","mentionCount":8,"brandAwareness":"NONE","buyingIntent":"HIGH"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":2,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"simulated — YouTube API unavailable","earlyAdopterProfile":"description"}`,

  validate: (product, sub, td) => td?.trend
    ? `Validate "${product}" in "${sub}" using REAL Google Trends data:\nDirection: ${td.trend.direction}\nMomentum: ${td.interpretation?.momentum}\nScore: ${td.trend.score}/10\nAt peak: ${td.trend.atPeak}\nRising queries: ${td.risingQueries?.slice(0,5).map(q=>q.query).join(', ')}\nBrand signals in related: ${td.brandSignalCount}\n\nReturn ONLY JSON: {"product":"${product}","dataSource":"REAL_GOOGLE_TRENDS","diffusionStage":"INNOVATORS/EARLY ADOPTERS/EARLY MAJORITY","trendStatus":"${td.trend.direction}","trendMomentum":"${td.interpretation?.momentum}","googleTrendsScore":${td.trend.score},"brandSaturation":"NONE/VERY LOW/LOW/MEDIUM","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"${td.interpretation?.verdict}","confidence":${td.trend.score},"premiumPricingRoom":"HIGH/MEDIUM/LOW","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"how long before gap closes"}`
    : `Validate "${product}" in "${sub}". Where on Diffusion curve? Want Early Adopters.\nReturn ONLY JSON: {"product":"${product}","dataSource":"SIMULATED","diffusionStage":"EARLY ADOPTERS","trendStatus":"GROWING FAST","trendMomentum":"estimated","brandSaturation":"VERY LOW","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"GOOD TIMING","confidence":7,"premiumPricingRoom":"HIGH","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"12-18 months"}`,

  avatar: (sub, product) => `Map the cultural identity of the "${sub}" person buying "${product}". Not demographics — find the tribe. Their "that girl" equivalent.\nReturn ONLY JSON: {"personaName":"name","age":"XX-XX","coreIdentity":"cultural movement","tribeLabel":"self-label","identityKeywords":["w1","w2","w3","w4","w5","w6"],"youtubeTitlePatterns":["pattern 1","pattern 2","pattern 3"],"aspirationalSelf":"who they're becoming","productRole":"functional or symbolic","painPoint":"exact frustration","buyingLanguage":["phrase1","phrase2","phrase3"],"whatTheyWantToFeel":"core emotion","whatRepelsThem":"brand killer","tribalEssence":"one sentence — cultural DNA"}`,

  brandResearch: (persona, identity, tribe) => `Find 3 non-competitor aspirational brands for: "${persona}" / "${identity}" / "${tribe}". Different product category, same person. Like Glossier for pilates girls.\nReturn ONLY JSON: {"inspirationBrands":[{"brand":"name","category":"sells","whySameAvatar":"why same person","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"ONE word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"}],"extractedColorStory":["dominant","secondary","accent","background"],"photographyBrief":"exact shoot brief","modelDirection":"who to cast","overallAestheticDirection":"2 sentences"}`,

  brand: (product, sub, identity, aesthetic) => `Brand identity for "${product}" in "${sub}" targeting "${identity}". Aesthetic: "${aesthetic}". Glossier naming: name = aspirational quality delivered, not the product.\nReturn ONLY JSON: {"namingLogic":"aspirational quality","nameOptions":[{"name":"n1","aspirationalQuality":"promise","logic":"why"},{"name":"n2","aspirationalQuality":"promise","logic":"why"},{"name":"n3","aspirationalQuality":"promise","logic":"why"}],"winner":"chosen","winnerLogic":"detailed why","tagline":"under 6 words","brandPromise":"what customer becomes","colorPalette":{"primary":"#hex","secondary":"#hex","accent":"#hex","bg":"#hex","text":"#hex"},"brandVoice":"3 words + how","whatItIsNot":"3 things","vsCompetitors":"how it differs","heroImageBrief":"shoot brief","websiteHeroHeadline":"H1 under 6 words","websiteHeroSubline":"subheadline","ctaText":"button"}`,

  shopify: (brand, product, sub, avatar) => `Shopify brief for "${brand}" / "${product}" / "${avatar}" in "${sub}". Brandy Melville simplicity + Glossier identity-first copy.\nReturn ONLY JSON: {"domain":"suggested.com","layoutInspiration":"brand + why","heroSection":{"headline":"text","subline":"text","cta":"text"},"navigation":["l1","l2","l3","l4"],"productDescription":"3 paragraphs identity-first","socialProofStrategy":"UGC plan","upsellLogic":"what + why","emailCaptureIdea":"lead magnet","conversionElements":["el1","el2","el3","el4"],"seoTitle":"meta title","seoDescription":"meta desc","shopifyTheme":"theme + why"}`,

  content: (brand, product, sub, avatar, identity) => `Viral content for "${brand}" / "${product}" / "${avatar}" (${identity}) in "${sub}". 30s transition rule: X-factor reveal at exactly 30s. Stitch tactic: find existing viral content that logically sets up the product.\nReturn ONLY JSON: {"contentPillars":[{"pillar":"name","resonance":"why","formats":["f1","f2"]},{"pillar":"name","resonance":"why","formats":["f1","f2"]},{"pillar":"name","resonance":"why","formats":["f1","f2"]}],"viralScripts":[{"title":"title","platform":"TikTok/Reels/Both","stitchConcept":"what + WHY","hook_0_3s":"script","setup_3_30s":"build","transition_30s":"X FACTOR REVEAL","close_30_60s":"close + CTA","viralMechanic":"why algorithm pushes","targetEmotion":"emotion at 30s"},{"title":"title","platform":"Both","stitchConcept":"stitch","hook_0_3s":"hook","setup_3_30s":"setup","transition_30s":"reveal","close_30_60s":"close","viralMechanic":"why","targetEmotion":"emotion"}],"retargetingStrategy":{"trigger":"50%+ view","audienceDescription":"who post-watch","adFormat":"static from shoot","expectedCVR":"X%+","adCopy":[{"headline":"h1","body":"2 sentences","cta":"btn"},{"headline":"h2","body":"2 sentences","cta":"btn"}]},"contentCalendar":[{"week":1,"theme":"t","posts":3,"goal":"g"},{"week":2,"theme":"t","posts":3,"goal":"g"},{"week":3,"theme":"t","posts":4,"goal":"g"},{"week":4,"theme":"t","posts":4,"goal":"g"}]}`,

  supplier: (brand, product, sub, price) => `Supplier pack for "${brand}" / "${product}" in "${sub}". Retail: ${price}. Search by supplier. Message 20-50. Negotiate with competing quotes.\nReturn ONLY JSON: {"manufacturingBrief":{"variants":["v1","v2","v3"],"colorways":["c1","c2","c3"],"customizations":["diff 1","diff 2","diff 3"],"logoPlacement":"instructions","packaging":"unboxing brief","targetCOGS":"$X-$X","suggestedRetail":"${price}","targetGrossMargin":"XX%","moq":"XXX units","materials":"specs","qualityDifferentiator":"vs dropship","leadTime":"X-X weeks"},"alibabaStrategy":{"searchTerms":["t1","t2","t3"],"filters":["Trade Assurance","Verified Pro","3+ years"],"suppliersToContact":"20-50","negotiationLeverage":"how to use quotes"},"outreachMessage":"full copy-paste message","sampleProcess":"what to check","negotiationScript":"word-for-word","redFlags":["rf1","rf2","rf3"],"estimatedBudget":{"inventory":"$X,XXX-$X,XXX","photography":"$1,500-$3,000","branding":"$500-$1,500","ads":"$2,000-$5,000","total":"$X,XXX-$XX,XXX"}}`
};

// ─── STAGES ───────────────────────────────────────────────────────────────────
const STAGES = [
  { id:"gap",      label:"Brand Gap",         icon:"◎", color:"#111827", desc:"Sub-community scan" },
  { id:"youtube",  label:"YouTube Data",      icon:"▶", color:"#2563eb", desc:"Real transcripts",    isData:true },
  { id:"trends",   label:"Google Trends",     icon:"↗", color:"#16a34a", desc:"Search momentum",     isData:true },
  { id:"mine",     label:"Signal Analysis",   icon:"⟁", color:"#2563eb", desc:"Reading transcripts" },
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

  trends: ({ d }) => (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <StatCard value={d.trend?.direction} label="Direction" color={d.trend?.direction?.includes("RISING") ? "#16a34a" : "var(--gray-900)"} />
        <StatCard value={d.interpretation?.verdict} label="Timing" color={d.interpretation?.verdict === "PERFECT TIMING" ? "#16a34a" : "#d97706"} />
        <StatCard value={`${d.trend?.score}/10`} label="Opportunity" />
      </div>
      <Row k="Momentum" v={d.interpretation?.momentum} />
      <Row k="Peak value" v={d.trend?.peakValue} />
      <Row k="Current value" v={d.trend?.currentValue} />
      <Divider />
      <Label>Rising search queries</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(d.risingQueries || []).slice(0, 6).map((q, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--gray-700)" }}>{q.query}</span>
            <Badge color="#16a34a">{q.value}</Badge>
          </div>
        ))}
      </div>
    </div>
  ),

  mine: ({ d }) => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Badge color={d.dataSource === "REAL_YOUTUBE" ? "#16a34a" : "#d97706"}>
          {d.dataSource === "REAL_YOUTUBE" ? "✓ Real data" : "~ Simulated"}
        </Badge>
        <Badge color="#16a34a">{d.verdict}</Badge>
      </div>
      <Card style={{ background: "var(--gray-50)", marginBottom: 16 }}>
        <Label>Key quotes from transcripts</Label>
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
      <Row k="Domain" v={d.domain} /><Row k="Layout" v={d.layoutInspiration} /><Row k="Theme" v={d.shopifyTheme} />
      <Divider />
      <Label>Product description — identity-first</Label>
      <Card style={{ background: "var(--gray-50)", marginBottom: 16 }}>
        <p style={{ fontSize: 13, lineHeight: 2, color: "var(--gray-700)" }}>{d.productDescription}</p>
      </Card>
      <Label>Conversion elements</Label>
      {d.conversionElements?.map((e, i) => (
        <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", minWidth: 22, paddingTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ fontSize: 13, color: "var(--gray-700)", lineHeight: 1.6 }}>{e}</span>
        </div>
      ))}
    </div>
  ),

  content: ({ d }) => (
    <div>
      {d.viralScripts?.map((v, i) => (
        <Card key={i} style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "var(--gray-900)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--white)" }}>{v.title}</span>
            <Badge color="white">{v.platform}</Badge>
          </div>
          <div style={{ padding: "12px 16px", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-200)" }}>
            <Label>Stitch concept</Label>
            <p style={{ fontSize: 12, color: "var(--gray-600)", lineHeight: 1.6 }}>{v.stitchConcept}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {[["Hook 0–3s", v.hook_0_3s, "#dc2626"], ["Setup 3–30s", v.setup_3_30s, "var(--gray-500)"], ["⚡ 30s X-Factor", v.transition_30s, "#d97706"], ["Close 30–60s", v.close_30_60s, "var(--gray-500)"]].map(([lbl, val, c], j) => (
              <div key={j} style={{ padding: "12px 16px", borderRight: j % 2 === 0 ? "1px solid var(--gray-200)" : "none", borderBottom: j < 2 ? "1px solid var(--gray-200)" : "none" }}>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: c, letterSpacing: "0.06em", marginBottom: 6 }}>{lbl}</div>
                <p style={{ fontSize: 12, color: "var(--gray-700)", lineHeight: 1.7 }}>{val}</p>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--gray-200)", background: "var(--gray-50)" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>Mechanic: </span>
            <span style={{ fontSize: 11, color: "var(--gray-600)", fontStyle: "italic" }}>{v.viralMechanic}</span>
          </div>
        </Card>
      ))}
      <Divider />
      <Row k="Retarget trigger" v={d.retargetingStrategy?.trigger} />
      <Row k="Expected CVR" v={d.retargetingStrategy?.expectedCVR} />
    </div>
  ),

  supplier: ({ d }) => {
    const b = d.manufacturingBrief || {};
    const bud = d.estimatedBudget || {};
    return (
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {[["MOQ", b.moq], ["COGS", b.targetCOGS], ["Retail", b.suggestedRetail], ["Margin", b.targetGrossMargin], ["Lead time", b.leadTime]].map(([k, v]) => v && <StatCard key={k} value={v} label={k} />)}
        </div>
        <Row k="Quality diff" v={b.qualityDifferentiator} />
        <Divider />
        <Label>Outreach message — copy and paste</Label>
        <pre style={{ fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", lineHeight: 1.8, padding: "14px 16px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", color: "var(--gray-700)", marginBottom: 16 }}>{d.outreachMessage}</pre>
        <Label>Budget estimate</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
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

// ─── PPT GENERATOR (unchanged from v2) ───────────────────────────────────────
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
  const brand = results.brand?.winner || 'BRAND';
  const product = results.gap?.winnerProduct || 'Product';
  const pal = results.brand?.colorPalette || {};
  const C = {
    ink: '111827', bg: 'FAFAFA', ac: 'D4531A', mid: '6B7280',
    faint: 'F4F4F5', white: 'FFFFFF',
    p1: (pal.primary || '#111827').replace('#', ''),
  };
  const W = 13.3, H = 7.5;
  const mk = () => ({ type: 'outer', blur: 6, offset: 2, angle: 135, color: '000000', opacity: 0.06 });

  // Cover
  const s1 = pres.addSlide(); s1.background = { color: C.ink };
  s1.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: H, fill: { color: C.p1 }, line: { color: C.p1 } });
  s1.addText(brand.toUpperCase(), { x: 0.45, y: 1.5, w: 11, h: 2.8, fontSize: 88, fontFace: 'Georgia', bold: true, color: C.white, margin: 0 });
  if (results.brand?.tagline) s1.addText(`"${results.brand.tagline}"`, { x: 0.45, y: 4.4, w: 10, h: 0.55, fontSize: 16, fontFace: 'Georgia', italic: true, color: '6B7280', margin: 0 });
  s1.addText(`${product}  ·  ${market}`, { x: 0.45, y: 5.2, w: 10, h: 0.35, fontSize: 11, fontFace: 'Calibri', color: '374151', charSpacing: 2, margin: 0 });

  // Gap
  if (results.gap) {
    const s2 = pres.addSlide(); s2.background = { color: C.bg };
    s2.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.9, fill: { color: C.ink }, line: { color: C.ink } });
    s2.addText('THE BRAND GAP', { x: 0.5, y: 0, w: W - 1, h: 0.9, fontSize: 26, fontFace: 'Georgia', bold: true, color: C.white, valign: 'middle', margin: 0 });
    s2.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.1, w: 0.06, h: 0.9, fill: { color: C.p1 }, line: { color: C.p1 } });
    s2.addText(results.gap.whyThisGap || '', { x: 0.7, y: 1.1, w: 9, h: 0.9, fontSize: 13, fontFace: 'Georgia', italic: true, color: '4B5563', valign: 'middle', wrap: true, margin: 0 });
    [['GAP SCORE', `${results.gap.gapScore}/10`], ['CAGR', results.gap.cagr], ['SATURATION', results.gap.brandSaturation], ['MARKET', results.gap.parentMarketSize]].forEach(([k, v], i) => {
      s2.addShape(pres.shapes.RECTANGLE, { x: 0.5 + (i * 3.1), y: 2.25, w: 2.9, h: 0.82, fill: { color: C.faint }, line: { color: 'E4E4E7' }, shadow: mk() });
      s2.addText(String(v || '—'), { x: 0.5 + (i * 3.1), y: 2.28, w: 2.9, h: 0.5, fontSize: 22, fontFace: 'Georgia', bold: true, color: C.ink, align: 'center', valign: 'middle', margin: 0 });
      s2.addText(k, { x: 0.5 + (i * 3.1), y: 2.8, w: 2.9, h: 0.2, fontSize: 7, fontFace: 'Calibri', color: '9CA3AF', align: 'center', charSpacing: 2, margin: 0 });
    });
    s2.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 3.28, w: 12.3, h: 0.58, fill: { color: C.faint }, line: { color: 'E4E4E7' } });
    s2.addText(`"${results.gap.howPeopleReferToIt}" — not a brand name`, { x: 0.7, y: 3.28, w: 11.5, h: 0.58, fontSize: 12, fontFace: 'Georgia', italic: true, color: '374151', valign: 'middle', margin: 0 });
    s2.addText('SUB-COMMUNITIES EVALUATED', { x: 0.5, y: 4.08, w: 8, h: 0.25, fontSize: 7, fontFace: 'Calibri', color: '9CA3AF', charSpacing: 3, margin: 0 });
    (results.gap.subCommunities || []).slice(0, 5).forEach((sc, i) => {
      const isW = sc.name === results.gap.winnerSubCommunity;
      s2.addShape(pres.shapes.RECTANGLE, { x: 0.5 + (i * 2.52), y: 4.38, w: 2.38, h: 0.82, fill: { color: isW ? C.ink : C.faint }, line: { color: isW ? C.ink : 'E4E4E7' } });
      s2.addText(sc.name, { x: 0.6 + (i * 2.52), y: 4.38, w: 2.2, h: 0.82, fontSize: 11, fontFace: 'Calibri', bold: isW, color: isW ? C.white : '374151', align: 'center', valign: 'middle', wrap: true, margin: 4 });
    });
  }

  // Brand Identity (dark)
  if (results.brand) {
    const s3 = pres.addSlide(); s3.background = { color: C.ink };
    s3.addText(brand.toUpperCase(), { x: 0.5, y: 0.4, w: 8.5, h: 3, fontSize: 88, fontFace: 'Georgia', bold: true, color: C.white, margin: 0 });
    s3.addText(`"${results.brand.tagline || ''}"`, { x: 0.5, y: 3.5, w: 8.5, h: 0.55, fontSize: 16, fontFace: 'Georgia', italic: true, color: '6B7280', margin: 0 });
    s3.addText(results.brand.brandPromise || '', { x: 0.5, y: 4.18, w: 7.5, h: 0.65, fontSize: 12, fontFace: 'Calibri', color: '9CA3AF', wrap: true, margin: 0 });
    Object.entries(pal).forEach(([k, v], i) => {
      const hex = (v || '').replace('#', '');
      s3.addShape(pres.shapes.OVAL, { x: 0.5 + (i * 0.75), y: 5.1, w: 0.55, h: 0.55, fill: { color: hex }, line: { color: '333333', pt: 1 } });
    });
    s3.addShape(pres.shapes.RECTANGLE, { x: 9.0, y: 0.4, w: 3.8, h: 6.4, fill: { color: '1F2937' }, line: { color: '374151' } });
    s3.addText('HERO COPY', { x: 9.2, y: 0.65, w: 3.4, h: 0.25, fontSize: 7, fontFace: 'Calibri', color: '6B7280', charSpacing: 3, margin: 0 });
    s3.addText(results.brand.websiteHeroHeadline || '', { x: 9.2, y: 1.0, w: 3.4, h: 1.0, fontSize: 18, fontFace: 'Georgia', bold: true, color: C.white, wrap: true, margin: 0 });
    s3.addText(results.brand.websiteHeroSubline || '', { x: 9.2, y: 2.1, w: 3.4, h: 0.65, fontSize: 11, fontFace: 'Calibri', color: '9CA3AF', wrap: true, margin: 0 });
    s3.addShape(pres.shapes.RECTANGLE, { x: 9.2, y: 2.9, w: 2.0, h: 0.42, fill: { color: C.p1 }, line: { color: C.p1 } });
    s3.addText(results.brand.ctaText || 'SHOP NOW', { x: 9.2, y: 2.9, w: 2.0, h: 0.42, fontSize: 10, fontFace: 'Calibri', bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s3.addText('BRAND VOICE', { x: 9.2, y: 3.6, w: 3.4, h: 0.25, fontSize: 7, fontFace: 'Calibri', color: '6B7280', charSpacing: 3, margin: 0 });
    s3.addText(results.brand.brandVoice || '', { x: 9.2, y: 3.88, w: 3.4, h: 0.5, fontSize: 11, fontFace: 'Calibri', color: '9CA3AF', wrap: true, margin: 0 });
  }

  // Content Strategy
  if (results.content) {
    const s4 = pres.addSlide(); s4.background = { color: C.bg };
    s4.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.9, fill: { color: C.ink }, line: { color: C.ink } });
    s4.addText('VIRAL CONTENT STRATEGY', { x: 0.5, y: 0, w: W - 1, h: 0.9, fontSize: 26, fontFace: 'Georgia', bold: true, color: C.white, valign: 'middle', margin: 0 });
    (results.content.viralScripts || []).slice(0, 2).forEach((v, si) => {
      const bx = 0.5 + (si * 6.4);
      s4.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.08, w: 6.1, h: 5.2, fill: { color: C.faint }, line: { color: 'E4E4E7' }, shadow: mk() });
      s4.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.08, w: 6.1, h: 0.48, fill: { color: '1F2937' }, line: { color: '1F2937' } });
      s4.addText(v.title || '', { x: bx + 0.1, y: 1.08, w: 5.9, h: 0.48, fontSize: 11, fontFace: 'Calibri', bold: true, color: C.white, valign: 'middle', margin: 0 });
      [['Hook 0–3s', v.hook_0_3s], ['Setup 3–30s', v.setup_3_30s], ['⚡ 30s X-Factor', v.transition_30s], ['Close', v.close_30_60s]].forEach(([lbl, val], j) => {
        s4.addText(lbl, { x: bx + 0.15, y: 1.72 + (j * 1.02), w: 5.8, h: 0.2, fontSize: 7, fontFace: 'Calibri', color: j === 2 ? 'D97706' : '9CA3AF', charSpacing: 2, margin: 0 });
        s4.addText(String(val || ''), { x: bx + 0.15, y: 1.94 + (j * 1.02), w: 5.8, h: 0.7, fontSize: 10, fontFace: 'Calibri', color: '374151', wrap: true, valign: 'top', margin: 0 });
      });
    });
  }

  // Supplier
  if (results.supplier) {
    const s5 = pres.addSlide(); s5.background = { color: C.bg };
    s5.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.9, fill: { color: C.ink }, line: { color: C.ink } });
    s5.addText('SUPPLIER PACK', { x: 0.5, y: 0, w: W - 1, h: 0.9, fontSize: 26, fontFace: 'Georgia', bold: true, color: C.white, valign: 'middle', margin: 0 });
    const bud = results.supplier.estimatedBudget || {};
    Object.entries(bud).forEach(([k, v], i) => {
      const isT = k === 'total';
      s5.addShape(pres.shapes.RECTANGLE, { x: 0.5 + (i * 2.52), y: 1.08, w: 2.38, h: 0.82, fill: { color: isT ? C.ink : C.faint }, line: { color: isT ? C.ink : 'E4E4E7' } });
      s5.addText(String(v || '—'), { x: 0.5 + (i * 2.52), y: 1.1, w: 2.38, h: 0.5, fontSize: 18, fontFace: 'Georgia', bold: true, color: isT ? C.white : C.ink, align: 'center', valign: 'middle', margin: 0 });
      s5.addText(k.toUpperCase(), { x: 0.5 + (i * 2.52), y: 1.62, w: 2.38, h: 0.2, fontSize: 7, fontFace: 'Calibri', color: isT ? '6B7280' : '9CA3AF', align: 'center', charSpacing: 2, margin: 0 });
    });
    const b = results.supplier.manufacturingBrief || {};
    s5.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 2.12, w: 12.3, h: 0.58, fill: { color: C.faint }, line: { color: 'E4E4E7' } });
    s5.addText(`Quality diff: ${b.qualityDifferentiator || ''}`, { x: 0.7, y: 2.12, w: 11.5, h: 0.58, fontSize: 11, fontFace: 'Calibri', color: '374151', valign: 'middle', wrap: true, margin: 0 });
    s5.addText('OUTREACH MESSAGE', { x: 0.5, y: 2.9, w: 8, h: 0.25, fontSize: 7, fontFace: 'Calibri', color: '9CA3AF', charSpacing: 3, margin: 0 });
    s5.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 3.2, w: 12.3, h: 3.55, fill: { color: C.faint }, line: { color: 'E4E4E7' } });
    s5.addText((results.supplier.outreachMessage || '').slice(0, 320) + '…', { x: 0.7, y: 3.3, w: 11.8, h: 3.3, fontSize: 10, fontFace: 'Calibri', color: '6B7280', wrap: true, valign: 'top', margin: 0 });
  }

  // Launch roadmap
  const s6 = pres.addSlide(); s6.background = { color: C.ink };
  s6.addText('WHAT HAPPENS NEXT', { x: 0.5, y: 0.5, w: 12, h: 1.1, fontSize: 48, fontFace: 'Georgia', bold: true, color: C.white, margin: 0 });
  s6.addText('THE 30-DAY LAUNCH PLAYBOOK', { x: 0.5, y: 1.55, w: 12, h: 0.3, fontSize: 10, fontFace: 'Calibri', color: '6B7280', charSpacing: 3, margin: 0 });
  [['WEEK 1', 'Manufacturing', `Contact ${results.supplier?.alibabaStrategy?.suppliersToContact || '20-50'} Alibaba suppliers. Request samples + quotes.`],
   ['WEEK 2', 'Photo Shoot', 'One professional shoot. Real model. Real location. Authentic content.'],
   ['WEEK 3', 'Launch Content', '3 videos using 30s transition formula. No ads yet. Organic only.'],
   ['WEEK 4', 'Retargeting', `Static ads to 50%+ viewers. Expected CVR: ${results.content?.retargetingStrategy?.expectedCVR || '7%+'}`]
  ].forEach(([wk, title, desc], i) => {
    const bx = 0.5 + (i * 3.2);
    s6.addShape(pres.shapes.RECTANGLE, { x: bx, y: 2.1, w: 3.0, h: 4.9, fill: { color: '1F2937' }, line: { color: '374151' } });
    s6.addShape(pres.shapes.RECTANGLE, { x: bx, y: 2.1, w: 3.0, h: 0.05, fill: { color: C.p1 }, line: { color: C.p1 } });
    s6.addText(wk, { x: bx + 0.15, y: 2.22, w: 2.7, h: 0.25, fontSize: 8, fontFace: 'Calibri', color: '6B7280', charSpacing: 2, margin: 0 });
    s6.addText(title, { x: bx + 0.15, y: 2.5, w: 2.7, h: 0.55, fontSize: 15, fontFace: 'Georgia', bold: true, color: C.white, margin: 0 });
    s6.addText(desc, { x: bx + 0.15, y: 3.15, w: 2.7, h: 2.5, fontSize: 11, fontFace: 'Calibri', color: '9CA3AF', wrap: true, valign: 'top', margin: 0 });
    s6.addText(String(i + 1), { x: bx + 0.15, y: 5.6, w: 2.7, h: 1.1, fontSize: 56, fontFace: 'Georgia', bold: true, color: '374151', margin: 0 });
  });

  await pres.writeFile({ fileName: `${brand}-Brand-Report.pptx` });
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase]     = useState("idle");
  const [market, setMarket]   = useState("");
  const [stMap, setStMap]     = useState({});
  const [results, setResults] = useState({});
  const [tab, setTab]         = useState(null);
  const [log, setLog]         = useState([]);
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

    const go = async (id, prompt, msg) => {
      setSt(id, "running"); addLog(msg);
      const d = await callClaude(prompt);
      if (d._error) { setSt(id, "error"); addLog(`Failed: ${d._error}`); return null; }
      setRes(id, d); setSt(id, "done"); addLog(`Done`);
      await sleep(4000); return d;
    };

    try {
      const gap = await go("gap", P.gap(parentMarket), `Scanning "${parentMarket}" for brand gaps…`);
      if (!gap) { setPhase("done"); return; }
      addLog(`Found: ${gap.winnerProduct} in ${gap.winnerSubCommunity}`);

      setSt("youtube", "running"); addLog(`Fetching YouTube transcripts…`);
      const ytData = await fetchYouTube(gap.youtubeSearchTerm);
      if (ytData && !ytData.error) { setRes("youtube", ytData); setSt("youtube", "done"); addLog(`${ytData.videosWithTranscripts} transcripts extracted`); }
      else { setSt("youtube", "error"); addLog(`YouTube API unavailable — simulating`); }
      await sleep(1000);

      setSt("trends", "running"); addLog(`Fetching Google Trends…`);
      const trendsData = await fetchTrends(gap.winnerProduct);
      if (trendsData && !trendsData.error) { setRes("trends", trendsData); setSt("trends", "done"); addLog(`${trendsData.trend?.direction} · ${trendsData.interpretation?.momentum}`); }
      else { setSt("trends", "error"); addLog(`Trends API unavailable — simulating`); }
      await sleep(1000);

      const mine = await go("mine", P.mine(gap.winnerSubCommunity, gap.winnerProduct, ytData), `Analyzing ${ytData?.videosWithTranscripts || 0} transcripts…`);
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

      const ct = await go("content", P.content(id.winner, gap.winnerProduct, gap.winnerSubCommunity, av.personaName, av.coreIdentity), `Writing viral scripts…`);
      if (!ct) { setPhase("done"); return; }

      const su = await go("supplier", P.supplier(id.winner, gap.winnerProduct, gap.winnerSubCommunity, val.suggestedRetailPrice), `Building supplier pack…`);
      if (!su) { setPhase("done"); return; }

      addLog(`Complete — ${id.winner} is ready`);
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
  const allDone   = doneCount === STAGES.length;
  const pct       = (doneCount / STAGES.length) * 100;
  const brandName = results.brand?.winner;
  const Panel     = tab ? Panels[tab] : null;
  const stage     = tab ? STAGES.find(s => s.id === tab) : null;
  const EXAMPLES  = ["fitness", "golf", "skincare", "outdoor", "cycling", "yoga", "running", "surf"];

  return (
    <div style={{ minHeight: "100vh", background: "var(--white)", color: "var(--gray-900)", fontFamily: "var(--font-sans)" }}>
      <style>{FONTS + CSS}</style>

      {/* ── TOPBAR ── */}
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
          {brandName && <>
            <span style={{ color: "var(--gray-300)" }}>·</span>
            <span style={{ fontSize: 13, color: "var(--gray-500)" }}>{brandName}</span>
          </>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {phase === "running" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }}>
              <Spin size={12} />
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-500)" }}>{doneCount}/{STAGES.length}</span>
            </div>
          )}
          {allDone && (
            <button onClick={exportPPT} disabled={exporting} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", background: exporting ? "var(--gray-100)" : "var(--gray-900)",
              color: exporting ? "var(--gray-400)" : "white",
              borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500, transition: "all 0.15s"
            }}>
              {exporting ? <><Spin size={12} color="#9ca3af" /> Building…</> : "↓ Download PPT"}
            </button>
          )}
          {phase !== "idle" && (
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

      {/* ── PROGRESS BAR ── */}
      {phase !== "idle" && (
        <div style={{ height: 2, background: "var(--gray-100)" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--gray-900)", transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
        </div>
      )}

      {/* ── IDLE SCREEN ── */}
      {phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "60px 24px" }}>
          <div style={{ maxWidth: 520, width: "100%", animation: "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards" }}>

            {/* Eyebrow */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--gray-50)", border: "1px solid var(--gray-200)", borderRadius: 99, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-500)", marginBottom: 28, letterSpacing: "0.04em" }}>
              <span style={{ width: 6, height: 6, background: "#16a34a", borderRadius: "50%", display: "inline-block" }} />
              Real YouTube + Google Trends data
            </div>

            {/* Headline */}
            <h1 style={{ fontSize: 48, fontFamily: "var(--font-serif)", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--gray-900)", marginBottom: 16 }}>
              Find where people<br />
              <span style={{ fontStyle: "italic", color: "var(--gray-400)" }}>already spend,</span><br />
              but own no brand.
            </h1>

            <p style={{ fontSize: 15, color: "var(--gray-500)", lineHeight: 1.8, marginBottom: 36 }}>
              Nike owns <em>sports socks</em>. Nobody owns <em>Pilates socks</em>. Same market, billions in spend, zero brand ownership. Type a parent market — the agent finds the gap.
            </p>

            {/* Input */}
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
                  outline: "none", boxShadow: "var(--shadow-sm)",
                  transition: "border-color 0.15s, box-shadow 0.15s"
                }}
                onFocus={e => { e.target.style.borderColor = "var(--gray-400)"; e.target.style.boxShadow = "0 0 0 3px rgba(0,0,0,0.04)"; }}
                onBlur={e => { e.target.style.borderColor = "var(--gray-200)"; e.target.style.boxShadow = "var(--shadow-sm)"; }}
              />
              <button
                onClick={() => market.trim() && run(market.trim())}
                disabled={!market.trim()}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  padding: "8px 16px", background: market.trim() ? "var(--gray-900)" : "var(--gray-200)",
                  color: market.trim() ? "white" : "var(--gray-400)",
                  borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 500,
                  transition: "all 0.15s", cursor: market.trim() ? "pointer" : "default"
                }}
              >
                Run →
              </button>
            </div>

            {/* Example tags */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 40 }}>
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setMarket(ex)} style={{
                  padding: "5px 12px", border: "1px solid var(--gray-200)",
                  borderRadius: 99, fontSize: 12, color: "var(--gray-500)",
                  background: "white", transition: "all 0.15s"
                }}
                  onMouseEnter={e => { e.target.style.borderColor = "var(--gray-400)"; e.target.style.color = "var(--gray-900)"; }}
                  onMouseLeave={e => { e.target.style.borderColor = "var(--gray-200)"; e.target.style.color = "var(--gray-500)"; }}
                >{ex}</button>
              ))}
            </div>

            {/* What it does */}
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

      {/* ── RUNNING / DONE ── */}
      {phase !== "idle" && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "calc(100vh - 54px)" }}>

          {/* ── SIDEBAR ── */}
          <div style={{ borderRight: "1px solid var(--gray-200)", display: "flex", flexDirection: "column", background: "var(--gray-50)" }}>

            {/* Market label */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--gray-200)" }}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gray-400)", marginBottom: 4, letterSpacing: "0.08em" }}>MARKET</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--gray-900)", letterSpacing: "-0.01em" }}>{market}</div>
            </div>

            {/* Stage list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {STAGES.map(s => {
                const st = stMap[s.id] || "idle";
                const active = tab === s.id;
                const clickable = !!results[s.id];
                return (
                  <button
                    key={s.id}
                    onClick={() => clickable && setTab(s.id)}
                    style={{
                      width: "100%", padding: "8px 14px",
                      background: active ? "var(--white)" : "transparent",
                      borderLeft: `2px solid ${active ? "var(--gray-900)" : "transparent"}`,
                      display: "flex", alignItems: "center", gap: 10,
                      cursor: clickable ? "pointer" : "default", textAlign: "left",
                      transition: "all 0.12s", borderRight: "none", borderTop: "none", borderBottom: "none"
                    }}
                  >
                    {/* Status indicator */}
                    <div style={{ width: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {st === "running" && <Spin size={12} color={s.color} />}
                      {st === "done"    && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "block" }} />}
                      {st === "error"   && <span style={{ fontSize: 10, color: "#d97706" }}>~</span>}
                      {st === "idle"    && <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--gray-300)", display: "block" }} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 500, marginBottom: 1,
                        color: st === "done" ? (active ? "var(--gray-900)" : "var(--gray-700)") :
                               st === "running" ? "var(--gray-900)" : "var(--gray-400)",
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

            {/* PPT export */}
            {allDone && (
              <div style={{ borderTop: "1px solid var(--gray-200)", padding: "12px 14px" }}>
                <button onClick={exportPPT} disabled={exporting} style={{
                  width: "100%", padding: "9px 12px",
                  background: exporting ? "var(--gray-100)" : "var(--gray-900)",
                  color: exporting ? "var(--gray-400)" : "white",
                  borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.15s"
                }}>
                  {exporting ? <><Spin size={12} color="#9ca3af" /> Building deck…</> : "↓ Download PPT report"}
                </button>
              </div>
            )}

            {/* Log */}
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

          {/* ── MAIN PANEL ── */}
          <div style={{ overflowY: "auto", background: "var(--white)" }}>

            {/* Loading state */}
            {!tab && phase === "running" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
                <Spin size={24} />
                <div style={{ fontSize: 13, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>Scanning "{market}"</div>
                <div style={{ fontSize: 12, color: "var(--gray-300)", fontFamily: "var(--font-mono)" }}>click any completed stage to preview</div>
              </div>
            )}

            {/* Stage result */}
            {tab && Panel && results[tab] && (
              <div className="fadeUp" style={{ padding: "32px 40px", maxWidth: 720 }}>
                {/* Header */}
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

            {/* Complete screen */}
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
    </div>
  );
}
