export const config = { runtime: 'edge' };

/**
 * /api/reddit.js
 *
 * Fetches Reddit discussions about a product/community using SerpApi.
 * Replaces YouTube transcripts with real community text data.
 *
 * Required env vars:
 *   SERPAPI_KEY — same key used for Google Trends
 *
 * Usage:
 *   GET /api/reddit?q=wall+pilates+gear&community=pilates
 *
 * Returns:
 *   - Reddit posts with titles, snippets, subreddits
 *   - Extracted buying signals and pain points
 *   - Community language corpus for Claude to analyze
 */

function extractSignals(posts) {
  const buyingSignals = [];
  const painPoints = [];
  const productMentions = [];

  const buyingKeywords = ['recommend', 'looking for', 'best', 'where to buy', 'anyone tried', 'worth it', 'purchased', 'bought', 'love', 'obsessed', 'game changer'];
  const painKeywords = ['cant find', "can't find", 'wish', 'frustrating', 'annoying', 'no good', 'terrible', 'missing', 'need', 'looking for something'];

  for (const post of posts) {
    const text = `${post.title} ${post.snippet}`.toLowerCase();

    if (buyingKeywords.some(k => text.includes(k))) {
      buyingSignals.push(post.title);
    }
    if (painKeywords.some(k => text.includes(k))) {
      painPoints.push(post.title);
    }

    // Extract product-like mentions (nouns with adjectives)
    const productPattern = /\b([a-z]+ (?:mat|sock|grip|towel|bag|pouch|holder|strap|band|block|ring|ball|disc|slider|pad|glove|wrap|bottle|case|clip|hook|rack|stand|bag|kit|set)s?)\b/gi;
    const matches = text.match(productPattern) || [];
    productMentions.push(...matches);
  }

  return {
    buyingSignals: [...new Set(buyingSignals)].slice(0, 5),
    painPoints: [...new Set(painPoints)].slice(0, 5),
    productMentions: [...new Set(productMentions)].slice(0, 10)
  };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const community = searchParams.get('community') || '';

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
    // Search 1: Product-focused Reddit discussions
    const productQuery = `${query} reddit`;
    const productUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(productQuery)}&num=10&api_key=${serpApiKey}`;

    // Search 2: Community pain points and recommendations
    const communityQuery = community ? `${community} gear recommendations reddit` : `${query} recommendations reddit`;
    const communityUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(communityQuery)}&num=10&api_key=${serpApiKey}`;

    // Fetch both in parallel
    const [productRes, communityRes] = await Promise.all([
      fetch(productUrl),
      fetch(communityUrl)
    ]);

    const [productData, communityData] = await Promise.all([
      productRes.json(),
      communityRes.json()
    ]);

    // Extract Reddit results from organic results
    const extractRedditPosts = (data) => {
      return (data.organic_results || [])
        .filter(r => r.link?.includes('reddit.com'))
        .map(r => ({
          title: r.title || '',
          snippet: r.snippet || '',
          link: r.link || '',
          subreddit: (r.link.match(/r\/([^/]+)/) || [])[1] || 'unknown',
          date: r.date || ''
        }));
    };

    const productPosts = extractRedditPosts(productData);
    const communityPosts = extractRedditPosts(communityData);

    // Deduplicate
    const allLinks = new Set();
    const allPosts = [...productPosts, ...communityPosts].filter(p => {
      if (allLinks.has(p.link)) return false;
      allLinks.add(p.link);
      return true;
    });

    if (!allPosts.length) {
      return new Response(JSON.stringify({
        query,
        postsFound: 0,
        corpus: '',
        signals: { buyingSignals: [], painPoints: [], productMentions: [] },
        message: 'No Reddit discussions found — try a broader search term'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Build corpus for Claude
    const corpus = allPosts
      .map(p => `--- REDDIT: r/${p.subreddit} ---\n${p.title}\n${p.snippet}`)
      .join('\n\n');

    const signals = extractSignals(allPosts);

    return new Response(JSON.stringify({
      query,
      community,
      postsFound: allPosts.length,
      posts: allPosts,
      signals,
      corpus: corpus.slice(0, 15000),
      subreddits: [...new Set(allPosts.map(p => p.subreddit))].filter(s => s !== 'unknown')
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
