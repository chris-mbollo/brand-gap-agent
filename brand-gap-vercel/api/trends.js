/**
 * /api/trends.js
 *
 * Serverless function: fetches Google Trends data for a keyword.
 * Uses SerpApi as the intermediary (handles Google's scraping protections).
 *
 * Required env vars:
 *   SERPAPI_KEY — from https://serpapi.com (free tier: 100 searches/month)
 *
 * Usage:
 *   GET /api/trends?q=pilates+grip+socks&geo=US
 *
 * Returns:
 *   - interest over time (12 months)
 *   - related queries (rising + top)
 *   - trend direction + momentum score
 */

export const config = { runtime: 'nodejs' };

function scoreTrend(timelineData) {
  if (!timelineData?.length) return { score: 0, direction: 'unknown', momentum: 0 };

  const values = timelineData.map(d => d.values?.[0]?.extracted_value ?? d.value ?? 0);
  const recent = values.slice(-4); // last 4 data points
  const older = values.slice(0, 4); // first 4 data points

  const recentAvg = recent.reduce((a,b) => a+b, 0) / recent.length;
  const olderAvg = older.reduce((a,b) => a+b, 0) / older.length;
  const peakValue = Math.max(...values);
  const currentValue = values[values.length - 1];

  // Momentum: how much recent growth vs older baseline
  const momentum = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  // Direction
  let direction;
  if (momentum > 50) direction = 'SHARPLY RISING';
  else if (momentum > 20) direction = 'STEADILY RISING';
  else if (momentum > 0) direction = 'SLIGHTLY RISING';
  else if (momentum > -20) direction = 'FLAT';
  else direction = 'DECLINING';

  // Peak proximity (is it at peak or still climbing?)
  const atPeak = currentValue >= peakValue * 0.85;
  const earlyStage = recentAvg < peakValue * 0.4;

  // Score 0-10: higher = better gap opportunity
  // Want: rising but not yet at peak mainstream
  let score = 5;
  if (direction === 'SHARPLY RISING' && !atPeak) score = 9;
  else if (direction === 'STEADILY RISING' && !atPeak) score = 8;
  else if (direction === 'SHARPLY RISING' && atPeak) score = 6;
  else if (direction === 'SLIGHTLY RISING') score = 7;
  else if (direction === 'FLAT') score = 4;
  else if (direction === 'DECLINING') score = 2;

  return {
    score,
    direction,
    momentum: Math.round(momentum),
    recentAvg: Math.round(recentAvg),
    peakValue,
    currentValue,
    atPeak,
    earlyStage
  };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const geo = searchParams.get('geo') || 'US';

  if (!query) {
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

  try {
    // Interest over time (past 12 months)
    const timelineUrl = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(query)}&geo=${geo}&date=today+12-m&api_key=${serpApiKey}`;
    const timelineRes = await fetch(timelineUrl);
    const timelineData = await timelineRes.json();

    if (timelineData.error) {
      return new Response(JSON.stringify({ error: timelineData.error, tip: 'Check SERPAPI_KEY and quota at serpapi.com/manage-api-key' }), {
        status: 402, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Related queries
    const relatedUrl = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(query)}&geo=${geo}&data_type=RELATED_QUERIES&api_key=${serpApiKey}`;
    const relatedRes = await fetch(relatedUrl);
    const relatedData = await relatedRes.json();

    const timeline = timelineData.interest_over_time?.timeline_data || [];
    const risingQueries = relatedData.related_queries?.rising || [];
    const topQueries = relatedData.related_queries?.top || [];

    const trendScore = scoreTrend(timeline);

    // Extract brand signals from related queries
    // If top queries include brand names → saturation. If generic → gap.
    const allQueryTexts = [...risingQueries, ...topQueries].map(q => q.query?.toLowerCase() || '');
    const brandSignals = allQueryTexts.filter(q =>
      !q.includes(query.toLowerCase()) &&
      (q.includes('brand') || q.includes('best') || q.includes('review') || q.length < 20)
    );

    return new Response(JSON.stringify({
      query,
      geo,
      trend: trendScore,
      timelineMonths: timeline.length,
      timelineData: timeline.map(d => ({
        date: d.date,
        value: d.values?.[0]?.extracted_value || 0
      })),
      risingQueries: risingQueries.slice(0, 8).map(q => ({ query: q.query, value: q.extracted_value })),
      topQueries: topQueries.slice(0, 8).map(q => ({ query: q.query, value: q.extracted_value })),
      brandSignalCount: brandSignals.length,
      interpretation: {
        direction: trendScore.direction,
        opportunityScore: trendScore.score,
        momentum: `${trendScore.momentum > 0 ? '+' : ''}${trendScore.momentum}% vs 3 months ago`,
        verdict: trendScore.score >= 8 ? 'PERFECT TIMING' : trendScore.score >= 6 ? 'GOOD TIMING' : trendScore.score >= 4 ? 'BORDERLINE' : 'TOO LATE'
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=86400' // cache 24 hours
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
