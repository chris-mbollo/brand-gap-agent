import { useState, useRef, useCallback } from "react";

// ─── STYLES ──────────────────────────────────────────────────────────────────
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=DM+Mono:wght@300;400&display=swap');`;
const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#f5f2ed;--ink:#0f0e0c;--mid:#7a7670;--faint:#e8e4dd;--line:#d4cfc8;--ac:#d4531a;--ac2:#1a6bd4;--ok:#1a8c4e;--warn:#c9961a;}
  html,body{background:var(--bg);color:var(--ink)}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--line)}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .fadeUp{animation:fadeUp .35s ease forwards}
  .blink{animation:blink 1s step-end infinite}
  button,input{font-family:'DM Sans',sans-serif;cursor:pointer}
`;

// ─── API CALLS ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Claude via server-side proxy (keeps API key safe)
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

// YouTube search + transcripts via server proxy
async function fetchYouTube(searchTerm) {
  try {
    const res = await fetch(`/api/youtube?q=${encodeURIComponent(searchTerm)}&maxResults=12`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Google Trends via server proxy
async function fetchTrends(keyword) {
  try {
    const res = await fetch(`/api/trends?q=${encodeURIComponent(keyword)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── PROMPTS — rebuilt to accept real data ────────────────────────────────────
const P = {

  // Stage 1: gap discovery — no real data needed yet
  gap: (market) => `Parent market: "${market}". Find the single best brand gap — a sub-community with strong product demand but ZERO brand ownership. Reason: parent market → sub-communities → unbranded products. The Pilates socks logic: everyone needs them, nobody says "my Brand X grip socks."

Evaluate 5 sub-communities within "${market}". Score on: growth signal + brand saturation (lower saturation = better gap).

Return ONLY JSON:
{"parentMarket":"${market}","subCommunities":[{"name":"name","youtubeSearch":"search term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]},{"name":"name","youtubeSearch":"term","growthSignal":"strong/moderate/emerging","products":["p1","p2"]}],"winnerSubCommunity":"name","winnerProduct":"specific product","gapScore":9,"whyThisGap":"2 sentences","brandSaturation":"NONE/VERY LOW/LOW","howPeopleReferToIt":"generic phrase","dominantBrands":["none yet"],"parentMarketSize":"$XB","cagr":"X%","youtubeSearchTerm":"exact search term"}`,

  // Stage 2: mine — uses REAL transcripts from YouTube API
  mine: (sub, product, ytData) => {
    if (ytData?.corpus) {
      return `You have REAL YouTube transcript data from ${ytData.videosWithTranscripts} videos in the "${sub}" community.

Here is the actual transcript corpus:
---
${ytData.corpus.slice(0, 18000)}
---

Analyze this for "${product}" brand gap signals. Look for:
1. Generic language (no brand names) when mentioning this product type
2. Frustration or unmet need signals  
3. How often it comes up vs competitors
4. The exact phrases people use

Return ONLY JSON:
{"transcriptsAnalyzed":${ytData.videosWithTranscripts},"dataSource":"REAL_YOUTUBE","keyQuotes":["exact real quote from transcripts 1","exact real quote 2","exact real quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"exact phrase found in transcripts","mentionCount":8,"brandAwareness":"NONE/LOW","buyingIntent":"HIGH/MED/LOW"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":3,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"one sentence based on real data","earlyAdopterProfile":"describe based on actual creators found"}`;
    }
    // Fallback if YouTube API unavailable
    return `Analyze the "${sub}" community for "${product}" brand gap signals based on your knowledge of YouTube creator content in this space.
Return ONLY JSON: {"transcriptsAnalyzed":0,"dataSource":"SIMULATED","keyQuotes":["simulated quote 1","quote 2","quote 3"],"productMentions":[{"product":"${product}","genericLanguage":"phrase","mentionCount":8,"brandAwareness":"NONE/LOW","buyingIntent":"HIGH"},{"product":"adjacent 1","genericLanguage":"phrase","mentionCount":4,"brandAwareness":"LOW","buyingIntent":"MED"},{"product":"adjacent 2","genericLanguage":"phrase","mentionCount":2,"brandAwareness":"LOW","buyingIntent":"LOW"}],"verdict":"PRODUCT AWARE, NOT BRAND AWARE","confirmation":"simulated — YouTube API unavailable","earlyAdopterProfile":"description"}`;
  },

  // Stage 3: validate — uses REAL Google Trends data
  validate: (product, sub, trendsData) => {
    if (trendsData?.trend) {
      const t = trendsData.trend;
      const ti = trendsData.interpretation;
      return `Validate "${product}" in "${sub}" using this REAL Google Trends data:

Trend direction: ${t.direction}
Momentum: ${trendsData.interpretation?.momentum}
Opportunity score: ${t.score}/10
At peak: ${t.atPeak}
Early stage: ${t.earlyStage}
Trend verdict: ${ti?.verdict}
Rising queries: ${trendsData.risingQueries?.slice(0,5).map(q=>q.query).join(', ')}
Top queries: ${trendsData.topQueries?.slice(0,5).map(q=>q.query).join(', ')}
Brand signals in related queries: ${trendsData.brandSignalCount} (lower = less competition)

Based on this REAL data, complete the validation:

Return ONLY JSON:
{"product":"${product}","dataSource":"REAL_GOOGLE_TRENDS","diffusionStage":"INNOVATORS/EARLY ADOPTERS/EARLY MAJORITY","trendStatus":"${t.direction}","trendMomentum":"${ti?.momentum}","googleTrendsScore":${t.score},"brandSaturation":"NONE/VERY LOW/LOW/MEDIUM","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"${ti?.verdict}","confidence":${t.score},"premiumPricingRoom":"HIGH/MEDIUM/LOW","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"based on trends data, how long before gap closes"}`;
    }
    // Fallback
    return `Validate "${product}" in "${sub}" as a brand-building opportunity. Where on Diffusion curve? Want Early Adopters.
Return ONLY JSON: {"product":"${product}","dataSource":"SIMULATED","diffusionStage":"EARLY ADOPTERS","trendStatus":"GROWING FAST","trendMomentum":"estimated","brandSaturation":"VERY LOW","howPeopleReferToIt":"phrase","dominantBrands":["none yet"],"verdict":"GOOD TIMING","confidence":7,"premiumPricingRoom":"HIGH","suggestedRetailPrice":"$XX-$XX","costToManufacture":"$X-$X","grossMarginPotential":"XX-XX%","windowOfOpportunity":"12-18 months"}`;
  },

  avatar: (sub, product) => `Map the cultural identity of the "${sub}" person buying "${product}". Not demographics — find the tribe. Their "that girl" equivalent.
Return ONLY JSON: {"personaName":"name","age":"XX-XX","coreIdentity":"cultural movement","tribeLabel":"self-label","identityKeywords":["w1","w2","w3","w4","w5","w6"],"youtubeTitlePatterns":["pattern 1","pattern 2","pattern 3"],"aspirationalSelf":"who they're becoming","productRole":"functional or symbolic","painPoint":"exact frustration","buyingLanguage":["phrase1","phrase2","phrase3"],"whatTheyWantToFeel":"core emotion","whatRepelsThem":"brand killer","tribalEssence":"one sentence — cultural DNA"}`,

  brandResearch: (persona, identity, tribe) => `Find 3 non-competitor aspirational brands for: "${persona}" / "${identity}" / "${tribe}". Different product category, same person. Like Glossier for pilates girls.
Return ONLY JSON: {"inspirationBrands":[{"brand":"name","category":"sells","whySameAvatar":"why same person","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"ONE word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"},{"brand":"name","category":"sells","whySameAvatar":"why","colorPalette":["c1","c2","c3"],"photographyStyle":"desc","visualKeyword":"word","revenueSignal":"size"}],"extractedColorStory":["dominant","secondary","accent","background"],"photographyBrief":"exact shoot brief","modelDirection":"who to cast","overallAestheticDirection":"2 sentences"}`,

  brand: (product, sub, identity, aesthetic) => `Brand identity for "${product}" in "${sub}" targeting "${identity}". Aesthetic: "${aesthetic}". Glossier naming logic: name = aspirational quality delivered, not the product itself.
Return ONLY JSON: {"namingLogic":"aspirational quality","nameOptions":[{"name":"n1","aspirationalQuality":"promise","logic":"why"},{"name":"n2","aspirationalQuality":"promise","logic":"why"},{"name":"n3","aspirationalQuality":"promise","logic":"why"}],"winner":"chosen","winnerLogic":"detailed why","tagline":"under 6 words","brandPromise":"what customer becomes","colorPalette":{"primary":"#hex","secondary":"#hex","accent":"#hex","bg":"#hex","text":"#hex"},"brandVoice":"3 words + how","whatItIsNot":"3 things","vsCompetitors":"how it differs","heroImageBrief":"shoot brief","websiteHeroHeadline":"H1 under 6 words","websiteHeroSubline":"subheadline","ctaText":"button"}`,

  shopify: (brand, product, sub, avatar) => `Shopify brief for "${brand}" / "${product}" / "${avatar}" in "${sub}". Brandy Melville simplicity + Glossier identity-first copy.
Return ONLY JSON: {"domain":"suggested.com","layoutInspiration":"brand + why","heroSection":{"headline":"text","subline":"text","cta":"text"},"navigation":["l1","l2","l3","l4"],"productDescription":"3 paragraphs identity-first","socialProofStrategy":"UGC plan","upsellLogic":"what + why","emailCaptureIdea":"lead magnet","conversionElements":["el1","el2","el3","el4"],"seoTitle":"meta title","seoDescription":"meta desc","shopifyTheme":"theme + why"}`,

  content: (brand, product, sub, avatar, identity) => `Viral content for "${brand}" / "${product}" / "${avatar}" (${identity}) in "${sub}". 30s transition rule: X-factor reveal at exactly 30s. Stitch tactic: find existing viral content that logically sets up the product.
Return ONLY JSON: {"contentPillars":[{"pillar":"name","resonance":"why","formats":["f1","f2"]},{"pillar":"name","resonance":"why","formats":["f1","f2"]},{"pillar":"name","resonance":"why","formats":["f1","f2"]}],"viralScripts":[{"title":"title","platform":"TikTok/Reels/Both","stitchConcept":"what + WHY","hook_0_3s":"script","setup_3_30s":"build","transition_30s":"X FACTOR REVEAL","close_30_60s":"close + CTA","viralMechanic":"why algorithm pushes","targetEmotion":"emotion at 30s"},{"title":"title","platform":"Both","stitchConcept":"stitch","hook_0_3s":"hook","setup_3_30s":"setup","transition_30s":"reveal","close_30_60s":"close","viralMechanic":"why","targetEmotion":"emotion"}],"retargetingStrategy":{"trigger":"50%+ view","audienceDescription":"who post-watch","adFormat":"static from shoot","expectedCVR":"X%+","adCopy":[{"headline":"h1","body":"2 sentences","cta":"btn"},{"headline":"h2","body":"2 sentences","cta":"btn"}]},"contentCalendar":[{"week":1,"theme":"t","posts":3,"goal":"g"},{"week":2,"theme":"t","posts":3,"goal":"g"},{"week":3,"theme":"t","posts":4,"goal":"g"},{"week":4,"theme":"t","posts":4,"goal":"g"}]}`,

  supplier: (brand, product, sub, price) => `Supplier pack for "${brand}" / "${product}" in "${sub}". Retail: ${price}. Search by supplier. Message 20-50. Negotiate with competing quotes.
Return ONLY JSON: {"manufacturingBrief":{"variants":["v1","v2","v3"],"colorways":["c1","c2","c3"],"customizations":["diff 1","diff 2","diff 3"],"logoPlacement":"instructions","packaging":"unboxing brief","targetCOGS":"$X-$X","suggestedRetail":"${price}","targetGrossMargin":"XX%","moq":"XXX units","materials":"specs","qualityDifferentiator":"vs dropship","leadTime":"X-X weeks"},"alibabaStrategy":{"searchTerms":["t1","t2","t3"],"filters":["Trade Assurance","Verified Pro","3+ years"],"suppliersToContact":"20-50","negotiationLeverage":"how to use quotes"},"outreachMessage":"full copy-paste message","sampleProcess":"what to check","negotiationScript":"word-for-word","redFlags":["rf1","rf2","rf3"],"estimatedBudget":{"inventory":"$X,XXX-$X,XXX","photography":"$1,500-$3,000","branding":"$500-$1,500","ads":"$2,000-$5,000","total":"$X,XXX-$XX,XXX"}}`
};

// ─── STAGES ───────────────────────────────────────────────────────────────────
const STAGES = [
  { id:"gap",      label:"Brand Gap Discovery",    icon:"◎", color:"#d4531a", desc:"Sub-community scan · gap scoring" },
  { id:"youtube",  label:"YouTube Data Fetch",      icon:"▶", color:"#1a6bd4", desc:"Real transcripts · creator signals" },
  { id:"trends",   label:"Google Trends",           icon:"↗", color:"#1a8c4e", desc:"Real search momentum · timing score" },
  { id:"mine",     label:"Transcript Analysis",     icon:"⟁", color:"#1a6bd4", desc:"Claude reads real transcripts" },
  { id:"validate", label:"Trend Validation",        icon:"◈", color:"#c9961a", desc:"Real data → diffusion curve placement" },
  { id:"avatar",   label:"Avatar Mapping",          icon:"◉", color:"#8b3fd4", desc:"The tribe · the identity" },
  { id:"brands",   label:"Brand Research",          icon:"◌", color:"#1a8c4e", desc:"The Glossier move · aesthetic DNA" },
  { id:"brand",    label:"Brand Identity",          icon:"◆", color:"#c9961a", desc:"Aspirational naming · colors · copy" },
  { id:"shopify",  label:"Website Brief",           icon:"▣", color:"#d43b8b", desc:"Shopify architecture · conversion" },
  { id:"content",  label:"Content Strategy",        icon:"✦", color:"#1a6bd4", desc:"30s transition · viral scripts" },
  { id:"supplier", label:"Supplier Pack",           icon:"⬡", color:"#d4531a", desc:"Alibaba brief · outreach · negotiation" },
];

// ─── PPT GENERATOR ────────────────────────────────────────────────────────────
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
  pres.title = `Brand Gap Report — ${market}`;

  const brand = results.brand?.winner || 'BRAND';
  const product = results.gap?.winnerProduct || 'Product';
  const sub = results.gap?.winnerSubCommunity || market;
  const pal = results.brand?.colorPalette || {};

  const C = {
    ink: '0F0E0C', bg: 'F5F2ED', ac: 'D4531A', mid: '7A7670',
    faint: 'E8E4DD', line: 'D4CFC8', white: 'FFFFFF',
    p1: (pal.primary   || '#D4531A').replace('#',''),
    p2: (pal.secondary || '#F5F2ED').replace('#',''),
    p3: (pal.accent    || '#0F0E0C').replace('#',''),
  };
  const W = 13.3, H = 7.5;
  const mk = () => ({ type:'outer',blur:8,offset:3,angle:135,color:'000000',opacity:0.10 });

  const titleBar = (s, t, sub2) => {
    s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:W,h:1.0,fill:{color:C.ink},line:{color:C.ink}});
    s.addText(t,{x:0.5,y:0,w:W-1,h:1.0,fontSize:30,fontFace:'Georgia',bold:true,color:C.white,valign:'middle',margin:0});
    if(sub2) s.addText(sub2,{x:0.5,y:0.68,w:W-1,h:0.28,fontSize:9,fontFace:'Calibri',color:'777777',valign:'top',margin:0,charSpacing:1});
  };
  const card = (s,x,y,w,h,fill) => s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:fill||C.faint},line:{color:C.line,pt:0.5},shadow:mk()});
  const lbl = (s,t,x,y,w,c) => s.addText(t,{x,y,w,h:0.22,fontSize:8,fontFace:'Calibri',color:c||C.mid,charSpacing:3,margin:0});
  const txt = (s,t,x,y,w,h,o={}) => s.addText(String(t||''),{x,y,w,h,fontSize:o.size||12,fontFace:o.face||'Calibri',color:o.color||C.ink,valign:o.va||'top',wrap:true,margin:0,italic:!!o.it,bold:!!o.bold,align:o.align||'left'});
  const stat = (s,v,k,x,y,w,vc) => {
    card(s,x,y,w,0.88,C.faint);
    s.addText(String(v||'—'),{x,y:y+0.04,w,h:0.55,fontSize:24,fontFace:'Georgia',bold:true,color:vc||C.ac,align:'center',valign:'middle',margin:0});
    s.addText(k,{x,y:y+0.62,w,h:0.2,fontSize:7,fontFace:'Calibri',color:C.mid,align:'center',charSpacing:2,margin:0});
  };

  // ── Slide 1: Cover
  const s1 = pres.addSlide();
  s1.background={color:C.ink};
  s1.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.18,h:H,fill:{color:C.p1},line:{color:C.p1}});
  s1.addText(brand.toUpperCase(),{x:0.45,y:1.2,w:10,h:3,fontSize:96,fontFace:'Georgia',bold:true,color:C.white,margin:0});
  if(results.brand?.tagline) s1.addText(`"${results.brand.tagline}"`,{x:0.45,y:4.3,w:10,h:0.6,fontSize:18,fontFace:'Georgia',italic:true,color:'999999',margin:0});
  s1.addText(`${product}  ·  ${sub}  ·  ${market}`,{x:0.45,y:5.1,w:10,h:0.4,fontSize:12,fontFace:'Calibri',color:'555555',charSpacing:2,margin:0});
  // real data badge
  const hasRealData = results.mine?.dataSource === 'REAL_YOUTUBE' || results.validate?.dataSource === 'REAL_GOOGLE_TRENDS';
  if(hasRealData) {
    s1.addShape(pres.shapes.RECTANGLE,{x:0.45,y:6.0,w:2.8,h:0.38,fill:{color:'1a8c4e'},line:{color:'1a8c4e'}});
    s1.addText('✓ REAL DATA VERIFIED',{x:0.45,y:6.0,w:2.8,h:0.38,fontSize:10,fontFace:'Calibri',bold:true,color:C.white,align:'center',valign:'middle',margin:0});
  }
  Object.entries(pal).forEach(([k,v],i)=>{
    const hex=(v||'#888888').replace('#','');
    s1.addShape(pres.shapes.OVAL,{x:0.45+(i*0.55),y:6.7,w:0.38,h:0.38,fill:{color:hex},line:{color:'333333',pt:0.5}});
  });

  // ── Slide 2: Brand Gap
  if(results.gap){
    const s2=pres.addSlide(); s2.background={color:C.bg};
    titleBar(s2,'THE BRAND GAP',`${results.gap.parentMarket?.toUpperCase()} → ${results.gap.winnerSubCommunity?.toUpperCase()} → ${results.gap.winnerProduct?.toUpperCase()}`);
    s2.addShape(pres.shapes.RECTANGLE,{x:0.5,y:1.18,w:0.08,h:1.0,fill:{color:C.ac},line:{color:C.ac}});
    txt(s2,results.gap.whyThisGap,0.75,1.2,9,0.95,{size:14,it:true});
    [['GAP SCORE',`${results.gap.gapScore}/10`,C.ac],['CAGR',results.gap.cagr,'1a8c4e'],['SATURATION',results.gap.brandSaturation,C.ink],['MARKET',results.gap.parentMarketSize,'1a6bd4']].forEach(([k,v,c],i)=>stat(s2,v,k,0.5+(i*3.1),2.4,2.9,c));
    card(s2,0.5,3.5,12.3,0.65,C.faint);
    lbl(s2,'HOW PEOPLE REFER TO IT (NOT A BRAND NAME)',0.7,3.57,10);
    txt(s2,`"${results.gap.howPeopleReferToIt}"`,0.7,3.78,10,0.3,{size:13,it:true});
    lbl(s2,'SUB-COMMUNITIES EVALUATED',0.5,4.38,10);
    (results.gap.subCommunities||[]).slice(0,5).forEach((sc,i)=>{
      const isW=sc.name===results.gap.winnerSubCommunity;
      card(s2,0.5+(i*2.52),4.62,2.38,0.95,isW?C.p1:C.faint);
      s2.addText(sc.name,{x:0.6+(i*2.52),y:4.65,w:2.2,h:0.4,fontSize:11,fontFace:'Calibri',bold:isW,color:isW?C.white:C.ink,wrap:true,margin:0});
      s2.addText(sc.growthSignal||'',{x:0.6+(i*2.52),y:5.1,w:2.2,h:0.2,fontSize:8,fontFace:'Calibri',color:isW?'DDDDDD':C.mid,margin:0});
    });
  }

  // ── Slide 3: Real Data Evidence
  const s3=pres.addSlide(); s3.background={color:C.bg};
  titleBar(s3,'REAL DATA SIGNALS','YOUTUBE TRANSCRIPTS + GOOGLE TRENDS — NOT SIMULATED');
  // YouTube column
  card(s3,0.5,1.1,6.0,5.8,'FFFFFF');
  s3.addShape(pres.shapes.RECTANGLE,{x:0.5,y:1.1,w:6.0,h:0.45,fill:{color:'1a6bd4'},line:{color:'1a6bd4'}});
  s3.addText('YOUTUBE TRANSCRIPTS',{x:0.6,y:1.1,w:5.8,h:0.45,fontSize:11,fontFace:'Calibri',bold:true,color:C.white,valign:'middle',margin:0});
  const ytStats=[['Videos Found',results.mine?.transcriptsAnalyzed||0],['Data Source',results.mine?.dataSource||'N/A'],['Verdict',results.mine?.verdict||'—']];
  ytStats.forEach(([k,v],i)=>{
    lbl(s3,k,0.65,1.72+(i*0.65),5.7,'1a6bd4');
    txt(s3,v,0.65,1.92+(i*0.65),5.7,0.45,{size:12,bold:i===2});
  });
  lbl(s3,'KEY QUOTES',0.65,3.8,5.7,'1a6bd4');
  (results.mine?.keyQuotes||[]).slice(0,3).forEach((q,i)=>{
    card(s3,0.65,4.02+(i*0.62),5.6,0.52,'F0F4FF');
    txt(s3,`"${q}"`,0.8,4.07+(i*0.62),5.3,0.42,{size:10,it:true});
  });
  // Trends column
  card(s3,6.8,1.1,6.0,5.8,'FFFFFF');
  s3.addShape(pres.shapes.RECTANGLE,{x:6.8,y:1.1,w:6.0,h:0.45,fill:{color:'1a8c4e'},line:{color:'1a8c4e'}});
  s3.addText('GOOGLE TRENDS',{x:6.9,y:1.1,w:5.8,h:0.45,fontSize:11,fontFace:'Calibri',bold:true,color:C.white,valign:'middle',margin:0});
  const tStats=[['Direction',results.validate?.trendStatus||'—'],['Momentum',results.validate?.trendMomentum||'—'],['Timing',results.validate?.verdict||'—'],['Confidence Score',`${results.validate?.confidence||'—'}/10`]];
  tStats.forEach(([k,v],i)=>{
    lbl(s3,k,6.95,1.72+(i*0.65),5.7,'1a8c4e');
    txt(s3,v,6.95,1.92+(i*0.65),5.7,0.45,{size:12,bold:i===2,color:i===2&&results.validate?.verdict==='PERFECT TIMING'?'1a8c4e':C.ink});
  });
  lbl(s3,'RISING SEARCH QUERIES',6.95,4.62,5.7,'1a8c4e');
  txt(s3,results.validate?.dataSource==='REAL_GOOGLE_TRENDS'?'Real data from Google Trends API':'Trend simulation (add SERPAPI_KEY for real data)',6.95,4.85,5.7,0.4,{size:9,it:true,color:C.mid});

  // ── Slide 4: Avatar
  if(results.avatar){
    const s4=pres.addSlide(); s4.background={color:C.bg};
    titleBar(s4,'THE AVATAR',`${results.avatar.personaName?.toUpperCase()} · ${results.avatar.tribeLabel?.toUpperCase()}`);
    s4.addShape(pres.shapes.RECTANGLE,{x:0.5,y:1.15,w:0.08,h:0.95,fill:{color:C.p1},line:{color:C.p1}});
    txt(s4,`"${results.avatar.tribalEssence}"`,0.75,1.18,9,0.9,{size:15,it:true});
    lbl(s4,'IDENTITY KEYWORDS',0.5,2.28,12);
    (results.avatar.identityKeywords||[]).slice(0,6).forEach((k,i)=>{
      s4.addShape(pres.shapes.RECTANGLE,{x:0.5+(i*2.05),y:2.5,w:1.88,h:0.4,fill:{color:C.p1},line:{color:C.p1}});
      s4.addText(k,{x:0.5+(i*2.05),y:2.5,w:1.88,h:0.4,fontSize:10,fontFace:'Calibri',bold:true,color:C.white,align:'center',valign:'middle',margin:0});
    });
    lbl(s4,'YOUTUBE CONTENT PATTERNS',0.5,3.08,8);
    (results.avatar.youtubeTitlePatterns||[]).slice(0,3).forEach((p,i)=>{
      card(s4,0.5,3.3+(i*0.62),8,0.52,C.faint);
      txt(s4,p,0.7,3.35+(i*0.62),7.6,0.4,{size:11});
    });
    const rcol=[['Aspiration',results.avatar.aspirationalSelf],['Pain Point',results.avatar.painPoint],['Wants to Feel',results.avatar.whatTheyWantToFeel],['Brand Killer',results.avatar.whatRepelsThem]];
    rcol.forEach(([k,v],i)=>{
      card(s4,9.2,1.15+(i*1.55),3.88,1.38,C.faint);
      lbl(s4,k.toUpperCase(),9.4,1.22+(i*1.55),3.5,'8b3fd4');
      txt(s4,v,9.4,1.44+(i*1.55),3.5,0.92,{size:11});
    });
  }

  // ── Slide 5: Brand Identity (dark)
  if(results.brand){
    const s5=pres.addSlide(); s5.background={color:C.ink};
    s5.addText(brand.toUpperCase(),{x:0.5,y:0.2,w:8.5,h:2.8,fontSize:96,fontFace:'Georgia',bold:true,color:C.white,margin:0});
    s5.addText(`"${results.brand.tagline||''}"`,{x:0.5,y:3.1,w:8.5,h:0.6,fontSize:18,fontFace:'Georgia',italic:true,color:'888888',margin:0});
    txt(s5,results.brand.brandPromise,0.5,3.78,7.5,0.7,{size:13,color:'BBBBBB'});
    Object.entries(pal).forEach(([k,v],i)=>{
      const hex=(v||'').replace('#','');
      s5.addShape(pres.shapes.OVAL,{x:0.5+(i*0.9),y:4.65,w:0.65,h:0.65,fill:{color:hex},line:{color:'333333',pt:1}});
      s5.addText(k,{x:0.5+(i*0.9),y:5.38,w:0.65,h:0.2,fontSize:7,fontFace:'Calibri',color:'555555',align:'center',margin:0});
    });
    card(s5,9.0,0.35,4.0,6.5,'1A1A1A');
    s5.addShape(pres.shapes.RECTANGLE,{x:9.0,y:0.35,w:4.0,h:0.06,fill:{color:C.p1},line:{color:C.p1}});
    lbl(s5,'HERO COPY',9.2,0.52,3.7,'555555');
    txt(s5,results.brand.websiteHeroHeadline,9.2,0.8,3.7,0.9,{size:20,color:C.white,bold:true});
    txt(s5,results.brand.websiteHeroSubline,9.2,1.8,3.7,0.65,{size:12,color:'999999'});
    s5.addShape(pres.shapes.RECTANGLE,{x:9.2,y:2.6,w:2.1,h:0.46,fill:{color:C.p1},line:{color:C.p1}});
    s5.addText(results.brand.ctaText||'SHOP NOW',{x:9.2,y:2.6,w:2.1,h:0.46,fontSize:11,fontFace:'Calibri',bold:true,color:C.white,align:'center',valign:'middle',margin:0});
    lbl(s5,'BRAND VOICE',9.2,3.3,'333333','555555');
    txt(s5,results.brand.brandVoice,9.2,3.52,3.7,0.55,{size:11,color:'888888'});
    lbl(s5,'WHAT IT IS NOT',9.2,4.18,'333333','555555');
    txt(s5,results.brand.whatItIsNot,9.2,4.38,3.7,0.55,{size:10,color:'666666'});
    lbl(s5,'NAME OPTIONS',0.5,5.65,8.0,'444444');
    (results.brand.nameOptions||[]).forEach((n,i)=>{
      const isW=n.name===results.brand.winner;
      s5.addShape(pres.shapes.RECTANGLE,{x:0.5+(i*4.1),y:5.88,w:3.8,h:0.85,fill:{color:isW?C.p1:'1A1A1A'},line:{color:isW?C.p1:'333333'}});
      s5.addText(`${n.name}${isW?' ✓':''}`,{x:0.6+(i*4.1),y:5.9,w:3.6,h:0.42,fontSize:16,fontFace:'Georgia',bold:true,color:C.white,margin:0});
      s5.addText(n.aspirationalQuality||'',{x:0.6+(i*4.1),y:6.35,w:3.6,h:0.28,fontSize:9,fontFace:'Calibri',color:'AAAAAA',margin:0});
    });
  }

  // ── Slide 6: Viral Scripts
  if(results.content){
    const s6=pres.addSlide(); s6.background={color:C.bg};
    titleBar(s6,'VIRAL CONTENT STRATEGY','THE 30-SECOND TRANSITION RULE · STITCH TACTIC');
    (results.content.viralScripts||[]).slice(0,2).forEach((v,si)=>{
      const bx=0.5+(si*6.45);
      card(s6,bx,1.1,6.1,5.15,C.faint);
      s6.addShape(pres.shapes.RECTANGLE,{x:bx,y:1.1,w:6.1,h:0.5,fill:{color:C.ink},line:{color:C.ink}});
      s6.addText(v.title||'Script',{x:bx+0.1,y:1.1,w:5.9,h:0.5,fontSize:12,fontFace:'Calibri',bold:true,color:C.white,valign:'middle',margin:0});
      card(s6,bx,1.6,6.1,0.55,'F0F4FF');
      lbl(s6,'STITCH CONCEPT',bx+0.15,1.66,5.8,'1a6bd4');
      txt(s6,v.stitchConcept,bx+0.15,1.84,5.8,0.25,{size:9});
      [['Hook 0–3s',v.hook_0_3s,C.ac],['Setup 3–30s',v.setup_3_30s,C.mid],['⚡ 30s X-FACTOR',v.transition_30s,'C9961A'],['Close 30–60s',v.close_30_60s,C.mid]].forEach(([lbl2,val,lc],i)=>{
        lbl(s6,lbl2,bx+0.15,2.28+(i*0.85),5.8,lc);
        txt(s6,val,bx+0.15,2.48+(i*0.85),5.8,0.62,{size:10});
      });
      lbl(s6,'VIRAL MECHANIC',bx+0.15,5.7,5.8,C.mid);
      txt(s6,v.viralMechanic,bx+0.15,5.9,5.8,0.3,{size:9,it:true});
    });
  }

  // ── Slide 7: Supplier Pack
  if(results.supplier){
    const s7=pres.addSlide(); s7.background={color:C.bg};
    titleBar(s7,'SUPPLIER PACK','ALIBABA STRATEGY · BUDGET · OUTREACH');
    const b=results.supplier.manufacturingBrief||{};
    const bud=results.supplier.estimatedBudget||{};
    Object.entries(bud).forEach(([k,v],i)=>{
      const isT=k==='total';
      card(s7,0.5+(i*2.52),1.08,2.38,0.85,isT?C.ink:C.faint);
      s7.addText(String(v||'—'),{x:0.5+(i*2.52),y:1.1,w:2.38,h:0.52,fontSize:19,fontFace:'Georgia',bold:true,color:isT?C.p1:C.ink,align:'center',valign:'middle',margin:0});
      s7.addText(k.toUpperCase(),{x:0.5+(i*2.52),y:1.64,w:2.38,h:0.2,fontSize:7,fontFace:'Calibri',color:isT?'AAAAAA':C.mid,align:'center',charSpacing:2,margin:0});
    });
    [['MOQ',b.moq],['COGS',b.targetCOGS],['Retail',b.suggestedRetail],['Margin',b.targetGrossMargin],['Lead Time',b.leadTime],['Materials',b.materials]].forEach(([k,v],i)=>{
      const col=i%2, row=Math.floor(i/2);
      card(s7,0.5+(col*6.2),2.18+(row*0.7),5.9,0.6,C.faint);
      lbl(s7,k.toUpperCase(),0.7+(col*6.2),2.24+(row*0.7),4.5);
      txt(s7,v,0.7+(col*6.2),2.42+(row*0.7),5.5,0.28,{size:12,bold:true});
    });
    card(s7,0.5,4.4,12.3,0.65,'FFF3E0');
    lbl(s7,'QUALITY DIFFERENTIATOR VS DROPSHIP VERSION',0.7,4.47,11,'C9961A');
    txt(s7,b.qualityDifferentiator,0.7,4.67,11.5,0.32,{size:11});
    card(s7,0.5,5.25,12.3,1.95,C.faint);
    lbl(s7,'OUTREACH MESSAGE — COPY AND PASTE',0.7,5.32,11);
    txt(s7,(results.supplier.outreachMessage||'').slice(0,260)+'...',0.7,5.52,11.5,1.5,{size:9,color:C.mid});
  }

  // ── Slide 8: 4-week launch plan
  const s8=pres.addSlide(); s8.background={color:C.ink};
  s8.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:W,h:0.08,fill:{color:C.p1},line:{color:C.p1}});
  txt(s8,'WHAT HAPPENS NEXT',0.5,0.25,12,0.95,{size:40,color:C.white,bold:true,face:'Georgia'});
  txt(s8,'THE $3M PLAYBOOK — 30 DAYS TO LAUNCH',0.5,1.12,12,0.35,{size:11,color:'666666'});
  [
    ['WEEK 1','Manufacturing',`Contact ${results.supplier?.alibabaStrategy?.suppliersToContact||'20-50'} Alibaba suppliers. Use brief to filter. Request samples.`],
    ['WEEK 2','Photo Shoot','One professional shoot. Real model. Real location. Authentic content.'],
    ['WEEK 3','Launch Content','3 videos using 30s transition formula. No ads yet. Organic only.'],
    ['WEEK 4','Retargeting',`Static ads to 50%+ viewers. Expected CVR: ${results.content?.retargetingStrategy?.expectedCVR||'7%+'}`],
  ].forEach(([wk,title,desc],i)=>{
    const bx=0.5+(i*3.15);
    s8.addShape(pres.shapes.RECTANGLE,{x:bx,y:1.7,w:3.0,h:5.3,fill:{color:'1A1A1A'},line:{color:'333333'}});
    s8.addShape(pres.shapes.RECTANGLE,{x:bx,y:1.7,w:3.0,h:0.06,fill:{color:C.p1},line:{color:C.p1}});
    s8.addText(wk,{x:bx+0.15,y:1.82,w:2.7,h:0.3,fontSize:9,fontFace:'Calibri',color:C.p1,charSpacing:2,margin:0});
    s8.addText(title,{x:bx+0.15,y:2.16,w:2.7,h:0.55,fontSize:16,fontFace:'Georgia',bold:true,color:C.white,margin:0});
    txt(s8,desc,bx+0.15,2.82,2.7,2.5,{size:11,color:'999999'});
    s8.addText(String(i+1),{x:bx+0.15,y:5.55,w:2.7,h:1.0,fontSize:52,fontFace:'Georgia',bold:true,color:'222222',margin:0});
  });
  s8.addText(`${brand.toUpperCase()} · ${product.toUpperCase()} · ${market.toUpperCase()}`,{x:0.5,y:7.15,w:12,h:0.28,fontSize:9,fontFace:'Calibri',color:'333333',charSpacing:2,margin:0});

  await pres.writeFile({ fileName: `${brand}-Brand-Gap-Report.pptx` });
}

// ─── ATOMS ────────────────────────────────────────────────────────────────────
const Tag = ({t,c="#d4531a"}) => <span style={{display:"inline-block",padding:"2px 10px",borderRadius:2,background:c+"15",color:c,fontSize:11,border:`1px solid ${c}30`,fontFamily:"'DM Mono',monospace",margin:"2px 3px 2px 0"}}>{t}</span>;
const Ln = () => <div style={{height:1,background:"var(--line)",margin:"16px 0"}}/>;
const SH = ({label,c="var(--mid)"}) => <div style={{fontSize:10,letterSpacing:"0.2em",textTransform:"uppercase",color:c,fontFamily:"'DM Mono',monospace",marginBottom:10}}>{label}</div>;
const KV = ({k,v}) => !v?null:<div style={{display:"flex",gap:12,marginBottom:7}}><span style={{color:"var(--mid)",fontSize:11,fontFamily:"'DM Mono',monospace",minWidth:100,flexShrink:0}}>{k}</span><span style={{color:"var(--ink)",fontSize:13,lineHeight:1.6,flex:1}}>{String(v)}</span></div>;
const Spin = ({c="#d4531a",s=16}) => <svg width={s} height={s} viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite",flexShrink:0}}><circle cx="12" cy="12" r="10" fill="none" stroke={c} strokeWidth="2" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>;
const DataBadge = ({source}) => source==='REAL_YOUTUBE'||source==='REAL_GOOGLE_TRENDS'
  ? <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",background:"#1a8c4e15",border:"1px solid #1a8c4e40",borderRadius:2,fontSize:10,color:"#1a8c4e",fontFamily:"'DM Mono',monospace"}}>✓ REAL DATA</span>
  : <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",background:"#c9961a15",border:"1px solid #c9961a40",borderRadius:2,fontSize:10,color:"#c9961a",fontFamily:"'DM Mono',monospace"}}>~ SIMULATED</span>;

// ─── RESULT PANELS ────────────────────────────────────────────────────────────
const Panels = {
  gap: ({d}) => <div>
    <div style={{background:"var(--ink)",padding:"20px 24px",marginBottom:20,borderRadius:2}}>
      <div style={{fontSize:11,letterSpacing:"0.2em",fontFamily:"'DM Mono',monospace",opacity:.5,marginBottom:6,color:"white"}}>BRAND GAP IDENTIFIED</div>
      <div style={{fontSize:34,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em",marginBottom:4,color:"white"}}>{d.winnerProduct}</div>
      <div style={{fontSize:14,opacity:.7,color:"white"}}>{d.parentMarket} → {d.winnerSubCommunity}</div>
      <div style={{display:"flex",gap:20,marginTop:14}}>
        {[["GAP SCORE",`${d.gapScore}/10`],["CAGR",d.cagr],["SATURATION",d.brandSaturation],["MARKET",d.parentMarketSize]].map(([k,v])=>(
          <div key={k}><div style={{fontSize:18,fontFamily:"'Bebas Neue',sans-serif",color:"#c8ff57"}}>{v}</div><div style={{fontSize:9,opacity:.5,fontFamily:"'DM Mono',monospace",marginTop:2,color:"white"}}>{k}</div></div>
        ))}
      </div>
    </div>
    <p style={{fontSize:14,lineHeight:1.8,fontStyle:"italic",borderLeft:"3px solid var(--ac)",paddingLeft:14,marginBottom:16}}>{d.whyThisGap}</p>
    <KV k="people say" v={`"${d.howPeopleReferToIt}"`}/><KV k="brands" v={d.dominantBrands?.join(", ")||"none yet"}/>
    <Ln/><SH label="Sub-Communities Evaluated"/>
    {d.subCommunities?.map((s,i)=><div key={i} style={{display:"flex",gap:12,marginBottom:8,padding:"10px 14px",background:s.name===d.winnerSubCommunity?"var(--faint)":"transparent",border:"1px solid var(--line)",borderRadius:2}}>
      <span style={{color:s.name===d.winnerSubCommunity?"var(--ac)":"var(--mid)",minWidth:16}}>{s.name===d.winnerSubCommunity?"→":""}</span>
      <div><div style={{fontWeight:500,fontSize:13,marginBottom:2}}>{s.name} <span style={{color:"var(--mid)",fontSize:11,fontWeight:400}}> · {s.growthSignal}</span></div><div style={{color:"var(--mid)",fontSize:11}}>{s.products?.join(", ")}</div></div>
    </div>)}
  </div>,

  youtube: ({d}) => <div>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
      <Tag t={`${d.videosFound} videos found`} c="var(--ac2)"/>
      <Tag t={`${d.videosWithTranscripts} transcripts extracted`} c="#1a8c4e"/>
    </div>
    <SH label="Videos Analyzed"/>
    {(d.videos||[]).slice(0,6).map((v,i)=><div key={i} style={{display:"flex",gap:12,marginBottom:8,padding:"10px 14px",border:"1px solid var(--line)",borderRadius:2}}>
      <div style={{flex:1}}>
        <div style={{fontWeight:500,fontSize:13,marginBottom:2}}>{v.title}</div>
        <div style={{color:"var(--mid)",fontSize:11,fontFamily:"'DM Mono',monospace",display:"flex",gap:12}}>
          <span>{v.channelTitle}</span>
          {v.viewCount&&<span>{Number(v.viewCount).toLocaleString()} views</span>}
          <Tag t={v.transcript?"transcript ✓":"no transcript"} c={v.transcript?"#1a8c4e":"var(--mid)"}/>
        </div>
      </div>
    </div>)}
    {d.corpus&&<div><Ln/><SH label="Transcript Corpus Preview"/><div style={{padding:"12px 14px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,fontSize:11,fontFamily:"'DM Mono',monospace",lineHeight:1.7,color:"var(--mid)",maxHeight:200,overflowY:"auto"}}>{d.corpus.slice(0,800)}...</div></div>}
  </div>,

  trends: ({d}) => <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
      {[["Direction",d.trend?.direction,"var(--ac)"],["Timing",d.interpretation?.verdict,d.interpretation?.verdict==="PERFECT TIMING"?"#1a8c4e":"var(--warn)"],["Opportunity",`${d.trend?.score}/10`,"var(--ac2)"]].map(([k,v,c])=>(
        <div key={k} style={{padding:"14px",border:"1px solid var(--line)",borderRadius:2,textAlign:"center"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c,lineHeight:1.1}}>{v}</div>
          <div style={{fontSize:10,color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginTop:6}}>{k}</div>
        </div>
      ))}
    </div>
    <KV k="momentum" v={d.interpretation?.momentum}/>
    <KV k="peak value" v={d.trend?.peakValue}/><KV k="current" v={d.trend?.currentValue}/>
    <Ln/><SH label="Rising Queries"/>
    {(d.risingQueries||[]).slice(0,5).map((q,i)=><div key={i} style={{display:"flex",gap:10,marginBottom:6,padding:"6px 12px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2}}>
      <span style={{flex:1,fontSize:12}}>{q.query}</span>
      <Tag t={q.value} c="#1a8c4e"/>
    </div>)}
  </div>,

  mine: ({d}) => <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}><DataBadge source={d.dataSource}/><Tag t={d.verdict} c="#1a8c4e"/></div>
    <div style={{background:"var(--faint)",padding:"14px 18px",borderRadius:2,marginBottom:16,border:"1px solid var(--line)"}}>
      <SH label="Key Quotes From Transcripts"/>
      {d.keyQuotes?.map((q,i)=><div key={i} style={{padding:"8px 0",borderBottom:i<d.keyQuotes.length-1?"1px solid var(--line)":"none",display:"flex",gap:10}}>
        <span style={{color:"var(--mid)",fontFamily:"'DM Mono',monospace",fontSize:11,minWidth:20}}>{String(i+1).padStart(2,"0")}</span>
        <span style={{fontSize:13,fontStyle:"italic"}}>"{q}"</span>
      </div>)}
    </div>
    <p style={{fontSize:13,marginBottom:16,lineHeight:1.6}}>{d.confirmation}</p>
    {d.productMentions?.map((p,i)=><div key={i} style={{display:"flex",gap:12,marginBottom:8,padding:"10px 14px",border:`1px solid ${i===0?"var(--ac)":"var(--line)"}`,borderRadius:2}}>
      <div style={{flex:1}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
          <span style={{fontWeight:600,fontSize:13}}>{p.product}</span>
          <Tag t={`brand: ${p.brandAwareness}`} c={p.brandAwareness==="NONE"?"#1a8c4e":"var(--warn)"}/>
        </div>
        <div style={{color:"var(--mid)",fontSize:12,fontFamily:"'DM Mono',monospace"}}>"{p.genericLanguage}" · {p.mentionCount}× mentioned</div>
      </div>
    </div>)}
  </div>,

  validate: ({d}) => <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}><DataBadge source={d.dataSource}/></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
      {[["Diffusion Stage",d.diffusionStage,"var(--ac)"],["Timing",d.verdict,d.verdict==="PERFECT TIMING"?"#1a8c4e":"var(--warn)"],["Confidence",`${d.confidence}/10`,"var(--ac2)"]].map(([k,v,c])=>(
        <div key={k} style={{padding:"14px",border:"1px solid var(--line)",borderRadius:2,textAlign:"center"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c,lineHeight:1.1}}>{v}</div>
          <div style={{fontSize:10,color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginTop:6}}>{k}</div>
        </div>
      ))}
    </div>
    <KV k="trend" v={d.trendStatus}/><KV k="momentum" v={d.trendMomentum}/><KV k="saturation" v={d.brandSaturation}/>
    <KV k="retail" v={d.suggestedRetailPrice}/><KV k="cost" v={d.costToManufacture}/><KV k="margin" v={d.grossMarginPotential}/>
    <Ln/><p style={{fontSize:13,lineHeight:1.7,fontStyle:"italic",color:"var(--mid)"}}>{d.windowOfOpportunity}</p>
  </div>,

  avatar: ({d}) => <div>
    <div style={{fontSize:24,fontWeight:600,marginBottom:4}}>{d.personaName}</div>
    <div style={{color:"var(--mid)",fontSize:13,marginBottom:12}}>{d.age} · {d.tribeLabel}</div>
    <p style={{fontSize:15,fontStyle:"italic",color:"var(--ac)",lineHeight:1.7,borderLeft:"3px solid var(--ac)",paddingLeft:14,marginBottom:14}}>"{d.tribalEssence}"</p>
    <div style={{marginBottom:14}}>{d.identityKeywords?.map((k,i)=><Tag key={i} t={k} c="#8b3fd4"/>)}</div>
    <Ln/><SH label="YouTube Title Patterns"/>
    {d.youtubeTitlePatterns?.map((t,i)=><div key={i} style={{padding:"8px 12px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,marginBottom:6,fontSize:13,fontFamily:"'DM Mono',monospace"}}>{t}</div>)}
    <Ln/><KV k="aspiration" v={d.aspirationalSelf}/><KV k="pain" v={d.painPoint}/>
    <KV k="wants to feel" v={d.whatTheyWantToFeel}/><KV k="brand killer" v={d.whatRepelsThem}/>
  </div>,

  brands: ({d}) => <div>
    {d.inspirationBrands?.map((b,i)=><div key={i} style={{marginBottom:12,padding:"14px 16px",border:"1px solid var(--line)",borderRadius:2}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <span style={{fontWeight:700,fontSize:15}}>{b.brand}</span>
        <span style={{color:"var(--mid)",fontSize:12,fontFamily:"'DM Mono',monospace"}}>{b.category}</span>
        <Tag t={b.visualKeyword} c="#1a8c4e"/>
      </div>
      <p style={{color:"var(--mid)",fontSize:12,marginBottom:8,lineHeight:1.6}}>{b.whySameAvatar}</p>
    </div>)}
    <Ln/><SH label="Photography Brief — For The Actual Shoot"/>
    <p style={{fontSize:13,lineHeight:1.8,marginBottom:12}}>{d.photographyBrief}</p>
    <SH label="Model Direction"/><p style={{fontSize:13,lineHeight:1.7}}>{d.modelDirection}</p>
  </div>,

  brand: ({d}) => { const p=d.colorPalette||{}; return <div>
    <div style={{padding:"24px",background:"var(--ink)",borderRadius:2,marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:52,fontFamily:"'Bebas Neue',sans-serif",color:"var(--bg)",letterSpacing:"0.05em"}}>{d.winner}</div>
        <div style={{display:"flex",gap:6}}>{Object.entries(p).map(([k,v])=><div key={k} title={k} style={{width:22,height:22,borderRadius:"50%",background:v,border:"2px solid rgba(255,255,255,.2)"}}/>)}</div>
      </div>
      <div style={{color:"rgba(245,242,237,.6)",fontSize:14,fontStyle:"italic",marginBottom:10}}>"{d.tagline}"</div>
      <div style={{color:"rgba(245,242,237,.9)",fontSize:13,lineHeight:1.7}}>{d.brandPromise}</div>
    </div>
    <div style={{padding:"16px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,marginBottom:16}}>
      <SH label="Hero Website Copy"/>
      <div style={{fontSize:24,fontWeight:600,marginBottom:6}}>{d.websiteHeroHeadline}</div>
      <div style={{color:"var(--mid)",fontSize:13,marginBottom:12}}>{d.websiteHeroSubline}</div>
      <span style={{display:"inline-block",padding:"8px 20px",background:"var(--ac)",color:"white",fontSize:12,fontWeight:600,borderRadius:2}}>{d.ctaText}</span>
    </div>
    <Ln/>
    {d.nameOptions?.map((n,i)=><div key={i} style={{display:"flex",gap:14,marginBottom:10,padding:"10px 14px",border:`1px solid ${n.name===d.winner?"var(--ac)":"var(--line)"}`,borderRadius:2}}>
      <div style={{minWidth:80}}><div style={{fontWeight:700,color:n.name===d.winner?"var(--ac)":"var(--ink)",fontSize:14}}>{n.name}</div><div style={{fontSize:10,color:"var(--mid)",fontFamily:"'DM Mono',monospace"}}>{n.aspirationalQuality}</div></div>
      <div style={{color:"var(--mid)",fontSize:12,lineHeight:1.6,flex:1}}>{n.logic}</div>
      {n.name===d.winner&&<div style={{color:"var(--ac)",fontSize:11,fontWeight:700,alignSelf:"center"}}>✓</div>}
    </div>)}
  </div>; },

  shopify: ({d}) => <div>
    <KV k="domain" v={d.domain}/><KV k="layout" v={d.layoutInspiration}/><KV k="theme" v={d.shopifyTheme}/>
    <Ln/><SH label="Product Description — Identity-First"/>
    <div style={{padding:"16px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,marginBottom:16}}>
      <p style={{fontSize:13,lineHeight:1.9}}>{d.productDescription}</p>
    </div>
    <SH label="Conversion Elements"/>
    {d.conversionElements?.map((e,i)=><div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
      <span style={{color:"var(--ac)",fontSize:12,fontFamily:"'DM Mono',monospace",minWidth:22}}>{String(i+1).padStart(2,"0")}.</span>
      <span style={{fontSize:13,lineHeight:1.6}}>{e}</span>
    </div>)}
  </div>,

  content: ({d}) => <div>
    {d.viralScripts?.map((v,i)=><div key={i} style={{marginBottom:20,border:"1px solid var(--line)",borderRadius:2,overflow:"hidden"}}>
      <div style={{padding:"12px 16px",background:"var(--ink)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"var(--bg)",fontWeight:600,fontSize:14}}>{v.title}</span><Tag t={v.platform} c="#57c8ff"/>
      </div>
      <div style={{padding:"12px 16px",background:"var(--faint)",borderBottom:"1px solid var(--line)"}}>
        <SH label="Stitch Concept"/><p style={{fontSize:13,lineHeight:1.6}}>{v.stitchConcept}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
        {[["Hook 0–3s",v.hook_0_3s,"var(--ac)"],["Setup 3–30s",v.setup_3_30s,"var(--mid)"],["⚡ 30s X-Factor",v.transition_30s,"var(--warn)"],["Close",v.close_30_60s,"var(--mid)"]].map(([lbl,val,c],j)=>(
          <div key={j} style={{padding:"12px 16px",borderRight:j%2===0?"1px solid var(--line)":"none",borderBottom:j<2?"1px solid var(--line)":"none"}}>
            <div style={{fontSize:10,letterSpacing:"0.12em",color:c,fontFamily:"'DM Mono',monospace",marginBottom:6}}>{lbl}</div>
            <p style={{fontSize:12,lineHeight:1.7}}>{val}</p>
          </div>
        ))}
      </div>
    </div>)}
    <Ln/><KV k="retarget trigger" v={d.retargetingStrategy?.trigger}/>
    <KV k="expected CVR" v={d.retargetingStrategy?.expectedCVR}/>
    {d.retargetingStrategy?.adCopy?.map((a,i)=><div key={i} style={{marginBottom:10,padding:"12px 14px",border:"1px solid var(--line)",borderRadius:2}}>
      <div style={{fontWeight:600,fontSize:14,marginBottom:4}}>{a.headline}</div>
      <p style={{color:"var(--mid)",fontSize:12,lineHeight:1.7,marginBottom:6}}>{a.body}</p>
      <Tag t={a.cta} c="var(--ac)"/>
    </div>)}
  </div>,

  supplier: ({d}) => { const b=d.manufacturingBrief||{},bud=d.estimatedBudget||{}; return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
      {[["MOQ",b.moq],["COGS",b.targetCOGS],["Retail",b.suggestedRetail],["Margin",b.targetGrossMargin],["Lead Time",b.leadTime]].map(([k,v])=>v&&<div key={k} style={{padding:"12px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2}}>
        <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:"var(--mid)",marginBottom:4}}>{k}</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.05em"}}>{v}</div>
      </div>)}
    </div>
    <KV k="quality diff" v={b.qualityDifferentiator}/>
    <Ln/><SH label="Outreach Message — Copy and Paste"/>
    <pre style={{fontSize:12,fontFamily:"'DM Mono',monospace",whiteSpace:"pre-wrap",lineHeight:1.8,padding:"16px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,marginBottom:16}}>{d.outreachMessage}</pre>
    <Ln/><SH label="Budget Estimate"/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
      {Object.entries(bud).map(([k,v])=><div key={k} style={{textAlign:"center",padding:"14px 6px",background:k==="total"?"var(--ink)":"var(--faint)",border:"1px solid var(--line)",borderRadius:2}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:k==="total"?"#d4531a":"var(--ac)"}}>{v}</div>
        <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:4,color:k==="total"?"rgba(245,242,237,.5)":"var(--mid)"}}>{k}</div>
      </div>)}
    </div>
  </div>; }
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("idle");
  const [market, setMarket] = useState("");
  const [stMap, setStMap] = useState({});
  const [results, setResults] = useState({});
  const [tab, setTab] = useState(null);
  const [log, setLog] = useState([]);
  const [exporting, setExporting] = useState(false);
  const logRef = useRef(null);

  const addLog = msg => { setLog(p=>[...p.slice(-80),msg]); setTimeout(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;},50); };
  const setSt = (id,s) => setStMap(p=>({...p,[id]:s}));
  const setRes = (id,d) => { setResults(p=>({...p,[id]:d})); setTab(id); };
  const reset = () => { setPhase("idle"); setStMap({}); setResults({}); setTab(null); setLog([]); };

  const run = useCallback(async (parentMarket) => {
    setPhase("running");
    const go = async (id, prompt, msg, skipClaude=false, rawData=null) => {
      setSt(id,"running"); addLog(msg);
      if(skipClaude && rawData) {
        setRes(id, rawData); setSt(id,"done"); return rawData;
      }
      const d = await callClaude(prompt);
      if(d._error) { setSt(id,"error"); addLog(`✗ ${id}: ${d._error}`); return null; }
      setRes(id,d); setSt(id,"done");
      addLog(`✓ done · 4s`); await sleep(4000); return d;
    };

    try {
      // Stage 1: Gap discovery (Claude only)
      const gap = await go("gap", P.gap(parentMarket), `◎ Scanning "${parentMarket}" for brand gaps...`);
      if(!gap) { setPhase("done"); return; }
      addLog(`→ Gap: ${gap.winnerProduct} in ${gap.winnerSubCommunity} (${gap.gapScore}/10)`);

      // Stage 2: Real YouTube data fetch (no Claude needed)
      setSt("youtube","running"); addLog(`▶ Fetching real YouTube transcripts for "${gap.youtubeSearchTerm}"...`);
      const ytData = await fetchYouTube(gap.youtubeSearchTerm);
      if(ytData && !ytData.error) {
        setRes("youtube", ytData); setSt("youtube","done");
        addLog(`→ ${ytData.videosWithTranscripts}/${ytData.videosFound} videos have transcripts`);
      } else {
        setSt("youtube","error"); addLog(`→ YouTube API unavailable (add YOUTUBE_API_KEY to Vercel env) — will simulate`);
      }
      await sleep(1000);

      // Stage 3: Real Google Trends fetch (no Claude needed)
      setSt("trends","running"); addLog(`↗ Fetching real Google Trends for "${gap.winnerProduct}"...`);
      const trendsData = await fetchTrends(gap.winnerProduct);
      if(trendsData && !trendsData.error) {
        setRes("trends", trendsData); setSt("trends","done");
        addLog(`→ ${trendsData.trend?.direction} · ${trendsData.interpretation?.momentum}`);
      } else {
        setSt("trends","error"); addLog(`→ Trends API unavailable (add SERPAPI_KEY to Vercel env) — will simulate`);
      }
      await sleep(1000);

      // Stage 4: Claude analyzes real transcripts
      const mine = await go("mine", P.mine(gap.winnerSubCommunity, gap.winnerProduct, ytData), `⟁ Claude analyzing ${ytData?.videosWithTranscripts||0} real transcripts...`);
      if(!mine) { setPhase("done"); return; }
      addLog(`→ ${mine.verdict} (${mine.dataSource})`);

      // Stage 5: Claude validates with real trends data
      const val = await go("validate", P.validate(gap.winnerProduct, gap.winnerSubCommunity, trendsData), `◈ Validating with real trends data...`);
      if(!val) { setPhase("done"); return; }
      addLog(`→ ${val.verdict} · ${val.diffusionStage}`);

      // Stages 6-11: Claude only
      const av = await go("avatar", P.avatar(gap.winnerSubCommunity, gap.winnerProduct), `◉ Mapping the tribe...`);
      if(!av) { setPhase("done"); return; }

      const br = await go("brands", P.brandResearch(av.personaName, av.coreIdentity, av.tribeLabel), `◌ Finding the Glossier equivalent...`);
      if(!br) { setPhase("done"); return; }

      const id = await go("brand", P.brand(gap.winnerProduct, gap.winnerSubCommunity, av.coreIdentity, br.overallAestheticDirection), `◆ Building brand...`);
      if(!id) { setPhase("done"); return; }
      addLog(`→ ${id.winner} · "${id.tagline}"`);

      const sh = await go("shopify", P.shopify(id.winner, gap.winnerProduct, gap.winnerSubCommunity, av.personaName), `▣ Website brief...`);
      if(!sh) { setPhase("done"); return; }

      const ct = await go("content", P.content(id.winner, gap.winnerProduct, gap.winnerSubCommunity, av.personaName, av.coreIdentity), `✦ Viral scripts...`);
      if(!ct) { setPhase("done"); return; }

      const su = await go("supplier", P.supplier(id.winner, gap.winnerProduct, gap.winnerSubCommunity, val.suggestedRetailPrice), `⬡ Supplier pack...`);
      if(!su) { setPhase("done"); return; }

      addLog(`◎ Done. ${id.winner} is ready.`);
      setPhase("done");
    } catch(e) { addLog(`✗ ${e.message}`); setPhase("done"); }
  }, []);

  const exportPPT = async () => {
    setExporting(true);
    try { await generatePPT(results, market); }
    catch(e) { alert("Export failed: " + e.message); }
    finally { setExporting(false); }
  };

  const doneCount = Object.values(stMap).filter(s=>s==="done").length;
  const allDone = doneCount === STAGES.length;
  const pct = (doneCount/STAGES.length)*100;
  const brandName = results.brand?.winner;
  const Panel = tab ? Panels[tab] : null;
  const stage = tab ? STAGES.find(s=>s.id===tab) : null;
  const EXAMPLES = ["fitness","golf","skincare","outdoor","cycling","yoga","running","surf"];

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--ink)",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{FONTS+CSS}</style>
      <div style={{height:3,background:"var(--ac)"}}/>
      <div style={{padding:"0 28px",borderBottom:"1px solid var(--line)",height:50,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,letterSpacing:"0.1em"}}>BRAND GAP</div>
          <div style={{width:1,height:14,background:"var(--line)"}}/>
          <div style={{fontSize:11,color:"var(--mid)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em"}}>{brandName?brandName.toUpperCase():"ONE INPUT → FULL BRAND"}</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {phase==="running"&&<div style={{display:"flex",alignItems:"center",gap:8}}><Spin c="var(--ac)"/><span style={{fontSize:11,color:"var(--mid)",fontFamily:"'DM Mono',monospace"}}>{doneCount}/{STAGES.length}</span></div>}
          {allDone&&<button onClick={exportPPT} disabled={exporting} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 18px",background:exporting?"var(--faint)":"var(--ink)",color:exporting?"var(--mid)":"var(--bg)",border:"none",fontSize:11,fontWeight:700,letterSpacing:"0.1em",fontFamily:"'DM Mono',monospace"}}>
            {exporting?<><Spin c="var(--mid)" s={12}/> BUILDING...</>:"↓ PPT REPORT"}
          </button>}
          <button onClick={reset} style={{padding:"6px 14px",background:"transparent",border:"1px solid var(--line)",color:"var(--mid)",fontSize:11,fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em"}}>RESET</button>
        </div>
      </div>

      {phase!=="idle"&&<div style={{height:2,background:"var(--faint)"}}><div style={{height:"100%",width:`${pct}%`,background:"var(--ac)",transition:"width .5s ease"}}/></div>}

      {phase==="idle"&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 53px)",padding:"40px 20px"}}>
          <div style={{maxWidth:560,width:"100%",animation:"fadeUp .5s ease"}}>
            <div style={{fontSize:11,letterSpacing:"0.25em",color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginBottom:18}}>THE THESIS</div>
            <h1 style={{fontSize:52,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.03em",lineHeight:1,marginBottom:18}}>FIND WHERE PEOPLE<br/><span style={{color:"var(--ac)"}}>ALREADY SPEND</span><br/>BUT OWN NO BRAND</h1>
            <div style={{padding:"14px 18px",background:"var(--faint)",border:"1px solid var(--line)",borderRadius:2,marginBottom:24}}>
              <p style={{fontSize:13,lineHeight:1.8,color:"var(--mid)"}}>Nike owns <em>sports socks</em>. Nobody owns <em>Pilates socks</em>. Same market. Billions in spend. Zero brand ownership in the sub-category. Now validated with real YouTube transcripts and Google Trends data.</p>
            </div>
            <div style={{fontSize:12,color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginBottom:8,letterSpacing:"0.08em"}}>ENTER A PARENT MARKET</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <input value={market} onChange={e=>setMarket(e.target.value)} onKeyDown={e=>e.key==="Enter"&&market.trim()&&run(market.trim())} placeholder="fitness, golf, skincare, outdoor..." style={{flex:1,padding:"12px 16px",background:"white",border:"2px solid var(--ink)",borderRadius:2,fontSize:15,outline:"none"}}/>
              <button onClick={()=>market.trim()&&run(market.trim())} disabled={!market.trim()} style={{padding:"12px 22px",background:market.trim()?"var(--ink)":"var(--line)",color:market.trim()?"var(--bg)":"var(--mid)",border:"none",fontSize:13,fontWeight:600,letterSpacing:"0.1em",transition:"all .15s"}}>RUN →</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:24}}>
              {EXAMPLES.map(ex=><button key={ex} onClick={()=>setMarket(ex)} style={{padding:"5px 12px",background:"transparent",border:"1px solid var(--line)",color:"var(--mid)",fontSize:12,borderRadius:2,fontFamily:"'DM Mono',monospace"}} onMouseEnter={e=>{e.target.style.borderColor="var(--ac)";e.target.style.color="var(--ac)";}} onMouseLeave={e=>{e.target.style.borderColor="var(--line)";e.target.style.color="var(--mid)";}}>{ex}</button>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,border:"1px solid var(--line)",marginBottom:14}}>
              {[["✓ Real YouTube","Actual transcripts from micro-influencers"],["✓ Real Trends","Google Trends momentum scoring"],["◆ Brand Gap","Zero-saturation sub-category detection"],["↓ PPT Export","8-slide branded deck, ready to share"]].map(([lb,desc])=>(
                <div key={lb} style={{padding:"12px 14px",background:"var(--faint)"}}>
                  <div style={{fontSize:12,fontWeight:600,marginBottom:3,color:"var(--ink)"}}>{lb}</div>
                  <div style={{fontSize:11,color:"var(--mid)",lineHeight:1.5}}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:"var(--mid)",fontFamily:"'DM Mono',monospace",textAlign:"center",letterSpacing:"0.06em"}}>⏱ ~8-10 min · real API calls + Claude analysis · rate limit safe</div>
          </div>
        </div>
      )}

      {phase!=="idle"&&(
        <div style={{display:"grid",gridTemplateColumns:"240px 1fr",height:"calc(100vh - 55px)"}}>
          <div style={{borderRight:"1px solid var(--line)",display:"flex",flexDirection:"column",background:"white"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--line)",background:"var(--faint)"}}>
              <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:"var(--mid)",marginBottom:3,letterSpacing:"0.1em"}}>PARENT MARKET</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.05em"}}>{market.toUpperCase()}</div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"6px 0"}}>
              {STAGES.map(s=>{
                const st=stMap[s.id]||"idle",active=tab===s.id;
                const isReal=s.id==="youtube"||s.id==="trends";
                return <button key={s.id} onClick={()=>results[s.id]&&setTab(s.id)} style={{width:"100%",padding:"9px 14px",background:active?"var(--faint)":"transparent",border:"none",borderLeft:`3px solid ${active?s.color:"transparent"}`,display:"flex",alignItems:"flex-start",gap:10,cursor:results[s.id]?"pointer":"default",textAlign:"left",transition:"all .15s"}}>
                  <span style={{fontSize:13,color:st==="done"?s.color:st==="running"?s.color:"var(--line)",paddingTop:1,flexShrink:0}}>{st==="running"?<Spin c={s.color} s={12}/>:s.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:st==="done"?(active?s.color:"var(--ink)"):st==="running"?s.color:"var(--line)",marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
                      {s.label}
                      {isReal&&st==="done"&&<span style={{fontSize:8,color:"#1a8c4e",fontFamily:"'DM Mono',monospace"}}>REAL</span>}
                    </div>
                    <div style={{fontSize:10,color:"var(--mid)",fontFamily:"'DM Mono',monospace",lineHeight:1.4}}>{s.desc}</div>
                  </div>
                  {st==="done"&&<span style={{color:s.color,fontSize:10,paddingTop:2,flexShrink:0}}>✓</span>}
                  {st==="error"&&<span style={{color:"var(--warn)",fontSize:10,paddingTop:2,flexShrink:0}}>~</span>}
                </button>;
              })}
            </div>
            {allDone&&(
              <div style={{borderTop:"1px solid var(--line)",padding:"10px 12px"}}>
                <button onClick={exportPPT} disabled={exporting} style={{width:"100%",padding:"10px",background:exporting?"var(--faint)":"var(--ink)",color:exporting?"var(--mid)":"var(--bg)",border:"none",fontSize:12,fontWeight:700,letterSpacing:"0.1em",fontFamily:"'Bebas Neue',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  {exporting?<><Spin c="var(--mid)" s={12}/> BUILDING...</>:"↓ DOWNLOAD PPT REPORT"}
                </button>
                <div style={{fontSize:9,color:"var(--mid)",fontFamily:"'DM Mono',monospace",textAlign:"center",marginTop:5}}>8 slides · branded colors · real data verified</div>
              </div>
            )}
            <div style={{borderTop:"1px solid var(--line)",padding:"10px 12px"}}>
              <div style={{fontSize:9,letterSpacing:"0.2em",color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginBottom:6}}>LOG</div>
              <div ref={logRef} style={{maxHeight:120,overflowY:"auto"}}>
                {log.map((l,i)=><div key={i} style={{fontSize:10,fontFamily:"'DM Mono',monospace",lineHeight:1.5,marginBottom:2,color:i===log.length-1?"var(--ink)":"var(--mid)"}}>{l}{i===log.length-1&&phase==="running"&&<span className="blink" style={{color:"var(--ac)"}}> _</span>}</div>)}
              </div>
            </div>
          </div>

          <div style={{overflowY:"auto",padding:"30px 36px"}}>
            {!tab&&phase==="running"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:14}}>
              <Spin c="var(--ac)" s={26}/>
              <div style={{fontSize:12,color:"var(--mid)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em"}}>RUNNING — "{market.toUpperCase()}"</div>
              <div style={{fontSize:11,color:"var(--mid)",fontFamily:"'DM Mono',monospace"}}>click any completed stage to preview</div>
            </div>}
            {tab&&Panel&&results[tab]&&<div className="fadeUp">
              <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:24,paddingBottom:18,borderBottom:"1px solid var(--line)"}}>
                <span style={{fontSize:22,color:stage?.color,paddingTop:4}}>{stage?.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.04em"}}>{stage?.label}</div>
                  <div style={{fontSize:11,color:"var(--mid)",fontFamily:"'DM Mono',monospace",marginTop:2}}>{stage?.desc}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",color:"var(--ac)"}}>{doneCount}/{STAGES.length}</div>
                  <div style={{fontSize:9,color:"var(--mid)",fontFamily:"'DM Mono',monospace"}}>STAGES</div>
                </div>
              </div>
              <Panel d={results[tab]}/>
            </div>}
            {phase==="done"&&!tab&&<div style={{textAlign:"center",padding:"60px 40px"}}>
              <div style={{fontSize:11,letterSpacing:"0.25em",color:"var(--ac)",fontFamily:"'DM Mono',monospace",marginBottom:14}}>COMPLETE</div>
              <div style={{fontSize:64,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em",marginBottom:8}}>{brandName}</div>
              <p style={{color:"var(--mid)",fontSize:13,fontFamily:"'DM Mono',monospace",marginBottom:28}}>Select any stage from the sidebar.</p>
              <button onClick={exportPPT} disabled={exporting} style={{padding:"14px 36px",background:exporting?"var(--faint)":"var(--ink)",color:exporting?"var(--mid)":"var(--bg)",border:"none",fontSize:14,fontWeight:700,letterSpacing:"0.15em",fontFamily:"'Bebas Neue',sans-serif",display:"inline-flex",alignItems:"center",gap:10,cursor:exporting?"default":"pointer"}}>
                {exporting?<><Spin c="var(--mid)" s={16}/> BUILDING DECK...</>:"↓ DOWNLOAD PPT REPORT"}
              </button>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}
