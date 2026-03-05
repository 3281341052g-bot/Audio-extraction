import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const maxDuration = 300; // 5 minutes

const execAsync = promisify(exec);

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    const direct = searchParams.get('direct') === '1';

    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const tmpBase = join(tmpdir(), `yt-${Date.now()}`);
    const tmpMp3 = `${tmpBase}.mp3`;

    try {
        if (direct) {
            // Direct URL (e.g. Kuaishou mp4): download with ffmpeg and extract audio
            const tmpInput = `${tmpBase}.mp4`;
            await execAsync(
                `curl -sL -o "${tmpInput}" --referer "https://www.kuaishou.com/" "${url}"`,
                { timeout: 120000 }
            );
            await execAsync(
                `ffmpeg -i "${tmpInput}" -vn -acodec libmp3lame -q:a 2 "${tmpMp3}"`,
                { timeout: 120000 }
            );
            unlink(tmpInput).catch(() => {});
        } else {
            // YouTube: use yt-dlp
            const tmpFile = `${tmpBase}.webm`;
            const { stderr } = await execAsync(
                `yt-dlp --format "bestaudio" --no-playlist -o "${tmpFile}" "${url}"`,
                { timeout: 120000 }
            );
            if (stderr) console.error('[yt-dlp stderr]', stderr.slice(0, 500));

            // Return webm directly for YouTube (no conversion needed)
            const data = await readFile(tmpFile);
            unlink(tmpFile).catch(() => {});
            return new Response(data, {
                headers: {
                    'Content-Type': 'audio/webm',
                    'Content-Disposition': 'attachment; filename="audio.webm"',
                    'Content-Length': String(data.length),
                },
            });
        }

        const data = await readFile(tmpMp3);
        unlink(tmpMp3).catch(() => {});
        return new Response(data, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Disposition': 'attachment; filename="audio.mp3"',
                'Content-Length': String(data.length),
            },
        });
    } catch (err: unknown) {
        unlink(tmpMp3).catch(() => {});
        const message = err instanceof Error ? err.message : '下载失败';
        console.error('[youtube API error]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
