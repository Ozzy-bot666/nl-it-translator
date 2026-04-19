# NL-IT Voice Translator 🇳🇱 ↔ 🇮🇹

Real-time voice translation between Dutch and Italian using Pipecat.

## Architecture

```
[Push-to-Talk] → [Deepgram STT] → [OpenAI Translate] → [Cartesia TTS] → [Speaker]
```

- **STT**: Deepgram (multi-language detection)
- **LLM**: OpenAI GPT-4 (translation)
- **TTS**: Cartesia (Italian/Dutch voices)
- **Transport**: Daily WebRTC

## Quick Start

### 1. Server Setup

```bash
cd server
uv sync
uv run bot.py -t daily
```

Server runs on `http://localhost:7860`

### 2. Client Setup

```bash
cd client
npm install
npm run dev
```

Client runs on `http://localhost:3000`

### 3. Use It

1. Open http://localhost:3000
2. Click "Connect"
3. Select mode: 🇳🇱→🇮🇹 or 🇮🇹→🇳🇱
4. Hold the button and speak
5. Release to hear the translation

## Environment Variables

### Server (.env)
- `DAILY_API_KEY` - Daily.co API key
- `OPENAI_API_KEY` - OpenAI API key
- `DEEPGRAM_API_KEY` - Deepgram API key
- `CARTESIA_API_KEY` - Cartesia API key

### Client (.env.local)
- `BOT_START_URL` - Server URL (default: http://localhost:7860/start)

## Deploy

### Server (Render)
- Runtime: Python
- Build: `pip install uv && uv sync`
- Start: `uv run bot.py -t daily`

### Client (Render/Vercel)
- Runtime: Node.js
- Build: `npm install && npm run build`
- Start: `npm start`

## License

MIT
