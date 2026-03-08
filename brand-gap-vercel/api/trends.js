export const config = { runtime: 'edge' };

/**
 * /api/trends.js — Triangulated Google Trends analysis
 * Searches 3 terms in parallel: product + community + problem
 * Returns composite gap score with seasonality, geography, and brand signal detection
 */

function scoreTrend(timelineData) {
  if (!timelineData?.length) return { score: 0, direction: 'unknown', momentum: 0, peakValue: 0, currentValue: 0, atPeak: false };

  const values = timelineData.map(d => d.values?.[0]?.extracted_value ?? d.value ?? 0).filter(v => v > 0);
  if (!values.length) return { score: 0, direction: 'unknown', momentum: 0, peakValue: 0, currentValue: 0, atPeak: false };

  const recent = values.slice(-4);
  const older = values.slice(0, 4);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const peakValue = Math.max(...values);
  const currentValue = values[values.length - 1];
  const momentum = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  let direction;
  if (momentum > 50)       direction = 'SHARPLY RISING';
  else if (momentum > 20)  direction = 'STEADILY RISING';
  else if (momentum > 0)   direction = 'SLIGHTLY RISING';
  else if (momentum > -20) direction = 'FLAT';
  else                     direction = 'DECLINING';

  const atPeak = currentValue >= peakValue * 0.85;

  let score = 5;
  if (direction === 'SHARPLY RISING' && !atPeak)  score = 9;
  else if (direction === 'STEADILY RISING' && !atPeak) score = 8;
  else if (direction === 'SHARPLY RISING' && atPeak)   score = 6;
  else if (direction === 'SLIGHTLY RISING')             score = 7;
  else if (direction === 'FLAT')                        score = 4;
  else if (direction === 'DECLINING')                   score = 2;

  return { score, direction, momentum: Math.round(momentum), recentAvg: Math.round(recentAvg), peakValue, currentValue, atPeak };
}

function detectBrandNames(queries) {
  // If rising queries contain brand-like terms (capitalized, short, no spaces) = saturation incoming
  const brandSignals = [];
  const genericSignals = [];
  for (const q of queries) {
    const text = q.query || '';
    const isBrand = /^[A-Z][a-z]+$/.test(text.split(' ')[0]) || text.split(' ').length <= 2 && text === text.toLowerCase() && text.length < 15;
    if (isBrand) brandSignals.push(text);
    else genericSignals.push(text);
  }
  return { brandSignals, genericSignals };
}

async function fetchTrendData(query, geo, serpApiKey) {
  try {
    const [timelineRes, relatedRes] = await Promise.all([
      fetch(`https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(query)}&geo=${geo}&date=today+12-m&api_key=${serpApiKey}`),
      fetch(`https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(query)}&geo=${geo}&data_type=RELATED_QUERIES&api_key=${serpApiKey}`)
    ]);
    const [timelineData, relatedData] = await Promise.all([timelineRes.json(), relatedRes.json()]);
    if (timelineData.error) return null;
    return { timelineData, relatedData, query };
  } catch { return null; }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const product   = searchParams.get('q');
  const community = searchParams.get('community') || '';
  const problem   = searchParams.get('problem') || '';
  const geo       = searchParams.get('geo') || 'US';

  if (!product) {
    return new Response(JSON.stringify({ error: 'q param required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) {
    return new Response(JSON.stringify({ error: 'SERPAPI_KEY not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Build 3 search terms — product, community, problem
  const terms = [product];
  if (community) terms.push(community);
  if (problem)   terms.push(problem);

// Fetch sequentially to avoid rate limits
const results = [];
for (const t of terms) {
  const r = await fetchTrendData(t, geo, serpApiKey);
  results.push(r);
  await new Promise(res => setTimeout(res, 500));
}
  const valid   = results.filter(Boolean);

  if (!valid.length) {
    return new Response(JSON.stringify({ error: 'No trend data returned' }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Score each term
  const scored = valid.map(r => {
    const timeline      = r.timelineData.interest_over_time?.timeline_data || [];
    const risingQueries = r.relatedData.related_queries?.rising || [];
    const topQueries    = r.relatedData.related_queries?.top || [];
    const trendScore    = scoreTrend(timeline);
    const { brandSignals, genericSignals } = detectBrandNames(risingQueries);

    return {
      term: r.query,
      trend: trendScore,
      risingQueries: risingQueries.slice(0, 8).map(q => ({ query: q.query, value: q.extracted_value })),
      topQueries: topQueries.slice(0, 8).map(q => ({ query: q.query, value: q.extracted_value })),
      brandSignals,
      genericSignals,
      timelineData: timeline.map(d => ({ date: d.date, value: d.values?.[0]?.extracted_value || 0 }))
    };
  });

  // Composite score — weighted: product (50%) + community (30%) + problem (20%)
  const weights   = [0.5, 0.3, 0.2];
  const composite = Math.round(
    scored.reduce((sum, s, i) => sum + s.trend.score * (weights[i] || 0.2), 0)
  );

  // Best signal = highest scoring term
  const best = scored.reduce((a, b) => a.trend.score > b.trend.score ? a : b);

  // Brand saturation signal — are brands appearing in rising queries?
  const allBrandSignals   = scored.flatMap(s => s.brandSignals);
  const allGenericSignals = scored.flatMap(s => s.genericSignals);
  const brandSaturationRisk = allBrandSignals.length > 8 ? 'HIGH' : allBrandSignals.length > 3 ? 'MEDIUM' : 'LOW';

  // Launch window — seasonality detection
  const productTimeline = scored[0]?.timelineData || [];
  const recentMonths    = productTimeline.slice(-8);
  const isRisingNow     = recentMonths.length > 1 &&
    recentMonths[recentMonths.length - 1].value > recentMonths[0].value;

  const verdict =
    composite >= 8 ? 'PERFECT TIMING' :
    composite >= 6 ? 'GOOD TIMING' :
    composite >= 4 ? 'BORDERLINE' : 'TOO LATE OR TOO EARLY';

  return new Response(JSON.stringify({
    product,
    geo,
    // Primary signal (backwards compatible)
    trend: best.trend,
    risingQueries: best.risingQueries,
    topQueries: best.topQueries,
    brandSignalCount: allBrandSignals.length,
    // New triangulated data
    compositeScore: composite,
    triangulation: scored.map(s => ({
      term:        s.term,
      score:       s.trend.score,
      direction:   s.trend.direction,
      momentum:    s.trend.momentum,
      brandSignals: s.brandSignals,
      genericSignals: s.genericSignals.slice(0, 5)
    })),
    brandSaturationRisk,
    isRisingNow,
    launchWindowOpen: (isRisingNow || composite >= 6) && brandSaturationRisk !== 'HIGH',
    interpretation: {
      direction:        best.trend.direction,
      opportunityScore: composite,
      momentum:         `${best.trend.momentum > 0 ? '+' : ''}${best.trend.momentum}% vs 3 months ago`,
      verdict,
      brandRisk:        brandSaturationRisk,
      recommendation:   brandSaturationRisk === 'LOW' && composite >= 6
        ? 'Move fast — low brand saturation with rising demand'
        : brandSaturationRisk === 'HIGH'
        ? 'Brands are moving in — differentiate immediately or pick a different gap'
        : 'Monitor closely — window is open but not peak yet'
    }
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=3600'
    }
  });
}
