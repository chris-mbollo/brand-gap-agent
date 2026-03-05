/**
 * /api/competitors.js
 *
 * Scans Amazon + Google Shopping for branded vs unbranded results.
 * Uses SerpApi for both. Confirms or kills the brand gap signal.
 *
 * Required env vars:
 *   SERPAPI_KEY
 *
 * Usage:
 *   GET /api/competitors?product=pilates+grip+socks&sub=reformer+pilates
 *
 * Returns:
 *   - amazonResults: top listings with brand detection
 *   - shoppingResults: Google Shopping top listings
 *   - brandedCount / unbrandedCount
 *   - saturationScore: 0-10 (0 = no brands, 10 = saturated)
 *   - verdict: CONFIRMED_GAP / WEAK_GAP / FALSE_GAP
 */

export const config = { runtime: 'nodejs' };

function detectBrand(title, brand_name) {
  if (brand_name && brand_name.toLowerCase() !== 'generic' && brand_name.length > 2) return true;
  // Generic brand signals in title
  const genericWords = ['generic', 'unbranded', 'no brand', 'pack of', 'set of', 'lot of'];
  const titleLower = (title || '').toLowerCase();
  if (genericWords.some(w => titleLower.includes(w))) return false;
  // If title starts with a proper noun-like word followed by product description, likely branded
  const words = titleLower.split(' ');
  if (words.length > 2 && /^[a-z]{3,}$/.test(words[0])) {
    // Check if first word is likely a brand (not a descriptor)
    const descriptors = ['best', 'top', 'new', 'premium', 'high', 'low', 'non', 'anti', 'pro', 'ultra', 'super', 'mini', 'grip', 'slip', 'soft', 'warm', 'cool', 'light'];
    if (!descriptors.includes(words[0])) return true;
  }
  return false;
}

function scoreSaturation(brandedCount, totalCount, priceRange) {
  if (totalCount === 0) return { score: 1, verdict: 'CONFIRMED_GAP' };

  const brandRatio = brandedCount / totalCount;

  // Score 0-10: lower = less saturated = better gap
  let score;
  if (brandRatio < 0.1)      score = 1;  // Almost no brands
  else if (brandRatio < 0.2) score = 2;
  else if (brandRatio < 0.35) score = 3;
  else if (brandRatio < 0.5) score = 5;
  else if (brandRatio < 0.65) score = 6;
  else if (brandRatio < 0.8) score = 8;
  else                        score = 9;

  // Price range signal: tight price range = commodity, wide = room for premium brand
  let pricingRoom = 'MEDIUM';
  if (priceRange.spread > 30) pricingRoom = 'HIGH';
  if (priceRange.spread < 10) pricingRoom = 'LOW';

  let verdict;
  if (score <= 2)      verdict = 'CONFIRMED_GAP';
  else if (score <= 4) verdict = 'WEAK_GAP';
  else if (score <= 6) verdict = 'CROWDED';
  else                 verdict = 'FALSE_GAP';

  return { score, verdict, brandRatio: Math.round(brandRatio * 100), pricingRoom };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const product = searchParams.get('product');
  const sub     = searchParams.get('sub') || '';

  if (!product) {
    return new Response(JSON.stringify({ error: 'product param required' }), {
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
    // Run Amazon + Google Shopping in parallel
    const [amazonRes, shoppingRes] = await Promise.all([
      fetch(`https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(product)}&api_key=${serpApiKey}`),
      fetch(`https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(product)}&gl=us&hl=en&api_key=${serpApiKey}`)
    ]);

    const [amazonData, shoppingData] = await Promise.all([
      amazonRes.json(),
      shoppingRes.json()
    ]);

    // ── Process Amazon results ──
    const amazonItems = (amazonData.organic_results || []).slice(0, 15).map(item => {
      const isBranded = detectBrand(item.title, item.brand_name || '');
      const price = parseFloat((item.price || '0').replace(/[^0-9.]/g, '')) || 0;
      return {
        title: item.title?.slice(0, 80),
        brand: item.brand_name || 'unknown',
        price,
        rating: item.rating,
        reviews: item.reviews,
        isBranded,
        asin: item.asin
      };
    });

    // ── Process Google Shopping results ──
    const shoppingItems = (shoppingData.shopping_results || []).slice(0, 15).map(item => {
      const isBranded = detectBrand(item.title, '');
      const price = parseFloat((item.price || '0').replace(/[^0-9.]/g, '')) || 0;
      return {
        title: item.title?.slice(0, 80),
        source: item.source,
        price,
        isBranded,
        thumbnail: null
      };
    });

    // ── Combine and score ──
    const allItems = [...amazonItems, ...shoppingItems];
    const totalCount    = allItems.length;
    const brandedCount  = allItems.filter(i => i.isBranded).length;
    const unbrandedCount = totalCount - brandedCount;

    // Price range analysis
    const prices = allItems.map(i => i.price).filter(p => p > 0);
    const priceRange = prices.length > 0 ? {
      min:    Math.min(...prices),
      max:    Math.max(...prices),
      avg:    Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      spread: Math.max(...prices) - Math.min(...prices)
    } : { min: 0, max: 0, avg: 0, spread: 0 };

    const saturation = scoreSaturation(brandedCount, totalCount, priceRange);

    // Top brands found (for context)
    const brandsFound = [...new Set(
      amazonItems.filter(i => i.brand && i.brand !== 'unknown').map(i => i.brand)
    )].slice(0, 6);

    // Review volume signal — high reviews on unbranded = huge opportunity
    const avgReviews = amazonItems
      .filter(i => i.reviews)
      .reduce((sum, i, _, arr) => sum + (parseInt(String(i.reviews).replace(/,/g, '')) / arr.length), 0);

    return new Response(JSON.stringify({
      product,
      sub,
      amazonCount:   amazonItems.length,
      shoppingCount: shoppingItems.length,
      totalScanned:  totalCount,
      brandedCount,
      unbrandedCount,
      saturationScore: saturation.score,
      brandRatio:      saturation.brandRatio,
      verdict:         saturation.verdict,
      pricingRoom:     saturation.pricingRoom,
      priceRange,
      avgReviewVolume: Math.round(avgReviews),
      brandsFound,
      topAmazonResults: amazonItems.slice(0, 6),
      topShoppingResults: shoppingItems.slice(0, 6),
      interpretation: {
        summary: `${brandedCount} branded / ${unbrandedCount} unbranded out of ${totalCount} results scanned`,
        signal: saturation.verdict === 'CONFIRMED_GAP'
          ? 'Strong gap signal — low brand ownership confirmed by real marketplace data'
          : saturation.verdict === 'WEAK_GAP'
          ? 'Moderate gap — some brands present but no clear dominant player'
          : saturation.verdict === 'CROWDED'
          ? 'Crowded space — multiple brands competing, harder entry'
          : 'Market saturated — strong brands already own this category',
        pricingOpportunity: priceRange.spread > 20
          ? `Wide price spread ($${priceRange.min}–$${priceRange.max}) — room for a premium brand at $${Math.round(priceRange.avg * 1.8)}`
          : `Narrow price range ($${priceRange.min}–$${priceRange.max}) — commodity pricing, needs strong brand differentiation`,
        reviewSignal: avgReviews > 500
          ? `High review volume (avg ${Math.round(avgReviews)}) confirms real demand`
          : `Low review volume — either early market or low intent`
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600'
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
