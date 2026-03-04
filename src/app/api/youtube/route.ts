import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
        // Stream audio directly from yt-dlp to the response
        const ytdlp = spawn('yt-dlp', [
            '--format', 'bestaudio',
            '--no-playlist',
            '-o', '-',  // output to stdout
            url,
        ]);

        let stderr = '';
        ytdlp.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        const stream = new ReadableStream({
            start(controller) {
                ytdlp.stdout.on('data', (chunk: Buffer) => controller.enqueue(chunk));
                ytdlp.stdout.on('end', () => controller.close());
                ytdlp.stdout.on('error', (e: Error) => controller.error(e));
                ytdlp.on('error', (e: Error) => controller.error(e));
            },
            cancel() {
                ytdlp.kill();
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'audio/webm',
                'Content-Disposition': 'attachment; filename="audio.webm"',
                'Cache-Control': 'no-cache',
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '下载失败';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
