# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run lint     # Run ESLint
```

No test framework is configured.

## Architecture

This is a Next.js App Router project that extracts audio from SoundCloud, Douyin (抖音), Qishui Music (汽水音乐), and generic M3U8 URLs.

**Two API routes:**
- `src/app/api/parse/route.ts` — Resolves a pasted URL to an array of audio segment URLs. Handles platform-specific extraction (SoundCloud widget API, Douyin HTML scraping, M3U8 playlist parsing).
- `src/app/api/proxy/route.ts` — CORS proxy that fetches audio segments on behalf of the browser.

**Single frontend page:**
- `src/app/page.tsx` — Client component. User pastes URL → calls `/api/parse` → downloads segments in parallel (concurrency=5) via `/api/proxy` → concatenates into a Blob → if MP4, runs ffmpeg.wasm in-browser to extract MP3. Displays an `<audio>` player and download button.

**Key dependencies:**
- `@ffmpeg/ffmpeg` + `@ffmpeg/util` — client-side MP4→MP3 conversion (WebAssembly, loaded once)
- `framer-motion` — animations
- `lucide-react` — icons

**Parse API response shape:**
```ts
{ segments: string[], isSingleFile?: boolean, format?: string }
```

**SoundCloud** caches `client_id` with a 12-hour TTL in a module-level variable.

**Douyin** parsing uses multiple regex fallback patterns against raw HTML since the page structure varies.
