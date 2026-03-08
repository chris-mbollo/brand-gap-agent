export const config = { runtime: 'edge' };

async function fetchTranscript(videoId) {
  try {
    const supadataKey = process.env.SUPADATA_API_KEY;
    if (!supadataKey) return null;
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=true`, {
      headers: { 'x-api-key': supadataKey },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.slice(0, 3000) || null;
  } catch { return null; }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const query      = searchParams.get('q');
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '12'), 12);

  if (!query) return new Response(JSON.stringify({ error: 'q param required' }), {
    status: 400, headers: { 'Content-Type': 'application/json' }
  });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'YOUTUBE_API_KEY not set' }), {
    status: 500, headers: { 'Content-Type': 'application/json' }
  });

  try {
    const searchRes  = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&relevanceLanguage=en&videoDuration=medium&key=${apiKey}`);
    const searchData = await searchRes.json();

    if (searchData.error) return new Response(JSON.stringify({ error: searchData.error.message, videos: [], videosFound: 0, videosWithTranscripts: 0, corpus: '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

    if (!searchData.items?.length) return new Response(JSON.stringify({ videos: [], videosFound: 0, videosWithTranscripts: 0, corpus: '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

    const videoIds = searchData.items.map(v => v.id?.videoId).filter(Boolean);

    // Fetch details and transcripts in parallel
    const [detailsRes, ...transcriptResults] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}&key=${apiKey}`),
      ...videoIds.map(id => fetchTranscript(id))
    ]);

    const detailsData = await detailsRes.json();
    const transcripts = transcriptResults;

    const videos = (detailsData.items || []).map((v, i) => ({
      videoId:      v.id,
      title:        v.snippet?.title,
      channelTitle: v.snippet?.channelTitle,
      description:  v.snippet?.description?.slice(0, 300),
      viewCount:    v.statistics?.viewCount,
      publishedAt:  v.snippet?.publishedAt,
      transcript:   transcripts[i] || null
    }));

    const videosWithTranscripts = videos.filter(v => v.transcript).length;
    const corpus = videos
      .filter(v => v.transcript)
      .map(v => `--- VIDEO: "${v.title}" by ${v.channelTitle} ---\n${v.transcript}`)
      .join('\n\n');

    return new Response(JSON.stringify({
      query,
      videosFound: videos.length,
      videosWithTranscripts,
      transcriptMethod: process.env.SUPADATA_API_KEY ? 'SUPADATA' : 'NONE — add SUPADATA_API_KEY',
      videos,
      corpus: corpus.slice(0, 30000)
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 's-maxage=3600' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
