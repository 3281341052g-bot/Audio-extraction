import { NextResponse } from 'next/server';

let cachedClientId: string | null = null;
let clientIdTime: number = 0;

async function getClientId() {
    // Use cached client ID for up to 12 hours
    if (cachedClientId && Date.now() - clientIdTime < 12 * 60 * 60 * 1000) {
        return cachedClientId;
    }

    try {
        const res = await fetch('https://soundcloud.com/');
        const html = await res.text();
        const scriptRegex = /<script[^>]+src="([^"]+)"/g;
        let match;
        const scriptUrls = [];
        while ((match = scriptRegex.exec(html)) !== null) {
            if (match[1].includes('sndcdn.com')) {
                scriptUrls.push(match[1]);
            }
        }
        for (let i = scriptUrls.length - 1; i >= 0; i--) {
            const scriptRes = await fetch(scriptUrls[i]);
            const scriptText = await scriptRes.text();
            const clientMatch = scriptText.match(/client_id:"([A-Za-z0-9_-]{32})/);
            if (clientMatch) {
                cachedClientId = clientMatch[1];
                clientIdTime = Date.now();
                return cachedClientId;
            }
        }
    } catch (error) {
        console.error('Failed to get client_id', error);
    }

    // High probability fallback
    return '1IzwHiVxAHeYKAMqN0IIGD3ZARgJy2kl';
}

export async function POST(req: Request) {
    try {
        const { url: rawInput } = await req.json();
        if (!rawInput) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        // Extract URL from pasted share text (e.g. "《歌名》@汽水音乐 https://qishui.douyin.com/s/xxx/")
        const urlMatch = rawInput.match(/https?:\/\/[^\s，。]+/);
        let url = urlMatch ? urlMatch[0].trim().replace(/\/$/, '') : rawInput.trim();

        // Follow short-link redirects for qishui.douyin.com/s/ URLs
        if (url.includes('qishui.douyin.com/s/') || url.includes('qishui.douyin.com/s')) {
            const redirectRes = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            url = redirectRes.url; // resolved final URL
        }

        let m3u8Url = url;

        // SC URL RESOLUTION
        if (url.includes('soundcloud.com')) {
            const clientId = await getClientId();
            const resolveUrl = `https://api-widget.soundcloud.com/resolve?url=${encodeURIComponent(url)}&format=json&client_id=${clientId}`;

            const resolveRes = await fetch(resolveUrl);
            if (!resolveRes.ok) {
                throw new Error(`Failed to resolve SoundCloud URL: ${resolveRes.statusText}`);
            }
            const trackData = await resolveRes.json();

            let transcodings = [];
            if (trackData.media && trackData.media.transcodings) {
                transcodings = trackData.media.transcodings;
            } else if (trackData.tracks && trackData.tracks[0]?.media?.transcodings) {
                // If a playlist URL was pasted, take first track
                transcodings = trackData.tracks[0].media.transcodings;
            } else {
                throw new Error('No media streams found in resolved SoundCloud track.');
            }

            // Prioritize HLS but specifically avoid 'audio/mpegurl' which sometimes 404s on widgets
            let target = transcodings.find((t: any) => t.format.protocol === 'hls' && t.format.mime_type === 'audio/mpeg');
            if (!target) {
                target = transcodings.find((t: any) => t.format.protocol === 'hls' && t.format.mime_type.includes('audio/mp4'));
            }
            if (!target) {
                target = transcodings.find((t: any) => t.format.protocol === 'hls');
            }
            if (!target) {
                target = transcodings[0];
            }

            if (!target || !target.url) {
                throw new Error('Could not find suitable audio stream from SoundCloud.');
            }

            let reqUrl = target.url + '?client_id=' + clientId;
            console.log('Fetching stream URL:', reqUrl);

            const streamRes = await fetch(reqUrl);
            if (!streamRes.ok) {
                const text = await streamRes.text();
                throw new Error(`Failed to get M3U8 payload from SoundCloud stream endpoint: ${streamRes.status} ${streamRes.statusText} - ${text}`);
            }
            const streamData = await streamRes.json();

            if (!streamData.url) {
                throw new Error('Could not get actual M3U8 URL from SoundCloud.');
            }

            m3u8Url = streamData.url;
        } else if (url.includes('music.douyin.com/qishui') || url.includes('douyinvod.com')) {
            // Qishui Music (Douyin Music) URL RESOLUTION
            let qishuiUrl = url;

            if (url.includes('music.douyin.com/qishui')) {
                const res = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
                    }
                });
                const html = await res.text();

                const regex = /_ROUTER_DATA = ({[\s\S]*?});?\n/;
                const match = html.match(regex);

                if (!match) {
                    throw new Error('Failed to parse qishui HTML for routing data');
                }

                const data = JSON.parse(match[1]);
                const trackPage = data.loaderData.track_page;

                if (!trackPage || !trackPage.audioWithLyricsOption || !trackPage.audioWithLyricsOption.url) {
                    throw new Error('Could not find audio streaming URL in qishui payload');
                }

                qishuiUrl = trackPage.audioWithLyricsOption.url;
            }

            // Qishui gives us an MP4/M4A video/audio stream URL, not an M3U8 list.
            // So we can just return this directly as a segment of 1.
            return NextResponse.json({ segments: [qishuiUrl], raw: qishuiUrl, isSingleFile: true });
        } else if (url.includes('v.douyin.com') || url.includes('douyin.com/video/') || url.includes('douyin.com/share/video') || url.includes('iesdouyin.com/share/video')) {
            // Douyin (TikTok China) video audio extraction
            let resolvedUrl = url;

            // Follow short-link redirect
            if (url.includes('v.douyin.com')) {
                const redirectRes = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9',
                    }
                });
                resolvedUrl = redirectRes.url;
                console.log('Redirected Douyin URL:', resolvedUrl);
            }

            // Extract video ID
            const videoIdMatch = resolvedUrl.match(/video\/(\d+)/) ||
                resolvedUrl.match(/aweme_id=(\d+)/) ||
                resolvedUrl.match(/\/(\d{15,19})\//);
            if (!videoIdMatch) {
                throw new Error(`无法解析抖音视频ID，实际地址：${resolvedUrl}`);
            }
            const videoId = videoIdMatch[1];
            console.log('Douyin video ID:', videoId);

            // Fetch the video page on douyin.com (Next.js SSR, embeds _ROUTER_DATA)
            const douyinPageUrl = `https://www.douyin.com/video/${videoId}`;
            const pageRes = await fetch(douyinPageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Referer': 'https://www.douyin.com/',
                }
            });
            const html = await pageRes.text();
            // Helper: decode JSON-escaped URLs (\u002F -> /  and \/ -> /)
            // JSON.parse handles all JSON escape sequences natively
            const decodeJsonUrl = (u: string) => { try { return JSON.parse('"' + u + '"') as string; } catch { return u; } };


            console.log('Douyin page length:', html.length,
                '| _ROUTER_DATA:', html.includes('_ROUTER_DATA'),
                '| RENDER_DATA:', html.includes('RENDER_DATA'),
                '| play_url:', html.includes('play_url'),
                '| playwm:', html.includes('playwm'));

            // Try all known douyin.com data-embedding patterns
            const routerPatterns = [
                /_ROUTER_DATA\s*=\s*({[\s\S]*?});\s*\n/,
                /window\.__routerData\s*=\s*({[\s\S]*?});\s*\n/,
                /<script id="RENDER_DATA" type="application\/json">([^<]+)<\/script>/,
                /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*\n/,
                /window\.__initialData__\s*=\s*({[\s\S]*?});\s*\n/,
            ];
            for (const pat of routerPatterns) {
                const m = html.match(pat);
                if (!m) continue;
                try {
                    const raw = m[1];
                    const data = JSON.parse(raw.startsWith('%') ? decodeURIComponent(raw) : raw);
                    const dataStr = JSON.stringify(data);
                    // Music URL (priority)
                    const muMatch = dataStr.match(/"play_url":\{"uri":"([^"]+)","url_list":\["([^"]+)"/) ||
                        dataStr.match(/"music_url":\{"uri":"([^"]+)","url_list":\["([^"]+)"/);
                    if (muMatch) {
                        const mu = decodeJsonUrl(muMatch[2] || muMatch[1]);
                        if (mu.startsWith('http')) return NextResponse.json({ segments: [mu], raw: mu, isSingleFile: true, format: 'mp3' });
                    }
                } catch { /* continue */ }
            }

            // Fallback: iesdouyin share page (SSR embeds watermarked video URL as JSON)
            const shareRes = await fetch(resolvedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                }
            });
            const shareHtml = await shareRes.text();
            console.log('share page length:', shareHtml.length, 'has playwm:', shareHtml.includes('playwm'));

            // Music first (mp3) - search for music play_url
            const shareMusicPatterns = [
                /"play_url":\{"uri":"[^"]+","url_list":\["([^"]+)"/,
                /"music_url":"(https?[^"]+)"/,
                /"play_url":\{[^}]{0,300}"url_list":\["([^"]+)"/,
            ];
            for (const pat of shareMusicPatterns) {
                const m = shareHtml.match(pat);
                if (m) {
                    const mu = decodeJsonUrl(m[m.length - 1]);
                    if (mu.startsWith('http')) {
                        console.log('Found music URL from share page');
                        return NextResponse.json({ segments: [mu], raw: mu, isSingleFile: true, format: 'mp3' });
                    }
                }
            }

            throw new Error('无法从该抖音视频中提取音乐，该视频可能没有背景音乐、已删除或设为私密。');

        }


        // Standard M3U8 Fetching
        const response = await fetch(m3u8Url);
        if (!response.ok) {
            throw new Error(`Failed to fetch m3u8: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();

        // Check if it's a playlist of playlists (master playlist)
        if (text.includes('#EXT-X-STREAM-INF')) {
            // Just grab the first stream and fetch it instead
            const lines = text.split('\n');
            for (const line of lines) {
                if (line && !line.startsWith('#')) {
                    const nestedUrl = line.startsWith('http') ? line : m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1) + line;
                    const nestedRes = await fetch(nestedUrl);
                    const nestedText = await nestedRes.text();
                    return parseSegments(nestedText, nestedUrl);
                }
            }
        }

        return parseSegments(text, m3u8Url);

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

function parseSegments(text: string, sourceUrl: string) {
    const lines = text.split('\n');
    const segments: string[] = [];
    const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            if (trimmedLine.startsWith('http')) {
                segments.push(trimmedLine);
            } else {
                segments.push(baseUrl + trimmedLine);
            }
        }
    }
    return NextResponse.json({ segments, raw: text });
}
