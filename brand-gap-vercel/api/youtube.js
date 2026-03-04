/**
 * /api/youtube.js
 * 
 * Serverless function: searches YouTube for videos by keyword,
 * then fetches transcripts for each. Returns cleaned transcript
 * text ready to feed into Claude.
 *
 * Required env vars:
 *   YOUTUBE_API_KEY — from Google Cloud Console (YouTube Data API v3)
 *
 * Usage:
 *   GET /api/youtube?q=reformer+pilates+grip+socks&maxResults=12
 */

export const config = { runtime: 'edge' };

// Fetch YouTube transcript via the timedtext endpoint
// (same endpoint YouTube uses internally for captions)
async function fetchTranscript(videoId) {
  try {
    // First get the video page to find caption track URL
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await pageRes.text();

    // Extract caption tracks from ytInitialPlayerResponse
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionMatch) return null;

    const tracks = JSON.parse(captionMatch[1].replace(/\\u0026/g, '&'));
    const englishTrack = tracks.find(t =>
      t.languageCode === 'en' || t.languageCode === 'en-US'
    ) || tracks[0];

    if (!englishTrack?.baseUrl) return null;

    // Fetch the actual transcript XML
    const transcriptRes = await fetch(englishTrack.baseUrl);
    const xml = await transcriptRes.text();

    // Parse XML and extract text
    const textMatches = xml.match(/<text[^>]*>(.*?)<\/text>/g) || [];
    const cleaned = textMatches
      .map(t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim())
      .filter(Boolean)
      .join(' ');

    return cleaned.slice(0, 3000); // cap per video
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const maxResults = parseInt(searchParams.get('maxResults') || '12');

  if (!query) {
    return new Response(JSON.stringify({ error: 'q param required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'YOUTUBE_API_KEY not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Search YouTube
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&relevanceLanguage=en&videoDuration=medium&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.items?.length) {
      return new Response(JSON.stringify({ videos: [], transcripts: [] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const videoIds = searchData.items.map(v => v.id?.videoId).filter(Boolean);

    // Fetch video details (title, description, view count)
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();

    // Fetch transcripts in parallel (with timeout)
    const transcriptPromises = videoIds.slice(0, 10).map(id =>
      Promise.race([
        fetchTranscript(id),
        new Promise(r => setTimeout(() => r(null), 6000)) // 6s timeout per video
      ])
    );
    const transcripts = await Promise.all(transcriptPromises);

    const videos = (detailsData.items || []).map((v, i) => ({
      videoId: v.id,
      title: v.snippet?.title,
      channelTitle: v.snippet?.channelTitle,
      description: v.snippet?.description?.slice(0, 300),
      viewCount: v.statistics?.viewCount,
      publishedAt: v.snippet?.publishedAt,
      transcript: transcripts[i] || null
    }));

    // Combined transcript corpus for Claude
    const corpus = videos
      .filter(v => v.transcript)
      .map(v => `--- VIDEO: "${v.title}" by ${v.channelTitle} ---\n${v.transcript}`)
      .join('\n\n');

    return new Response(JSON.stringify({
      query,
      videosFound: videos.length,
      videosWithTranscripts: videos.filter(v => v.transcript).length,
      videos,
      corpus: corpus.slice(0, 25000) // cap total corpus
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600' // cache for 1 hour
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
