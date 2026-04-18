# Dutch-Italian Real-time Voice Translator

Real-time bidirectional voice translation between Dutch and Italian using Pipecat.

- 🇳🇱 Speak Dutch → Hear Italian
- 🇮🇹 Speak Italian → Hear Dutch

## Architecture

- **Daily.co** - WebRTC transport for real-time audio
- **Deepgram** - Speech-to-text with multilingual detection
- **OpenAI** - GPT for translation
- **Cartesia** - Text-to-speech with native voices

## Setup

### 1. Install dependencies

```bash
pip install uv  # if not installed
uv sync
```

### 2. Configure environment

```bash
cp env.example .env
# Edit .env with your API keys
```

### 3. Run locally

```bash
uv run bot.py -t daily
```

Visit `http://localhost:7860/` to join the Daily room.

### 4. Open translation client

```bash
open index.html
```

Select "Dutch" or "Italian" track based on which translation you want to hear.

## Docker

```bash
docker build -t nl-it-translator .
docker run --env-file .env -p 7860:7860 nl-it-translator
```

## API Keys Needed

| Service | Purpose | Get it at |
|---------|---------|-----------|
| Daily.co | WebRTC rooms | https://dashboard.daily.co |
| Deepgram | Speech-to-text | https://console.deepgram.com |
| OpenAI | Translation | https://platform.openai.com |
| Cartesia | Text-to-speech | https://cartesia.ai |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DAILY_API_KEY` | Yes | Daily.co API key |
| `DEEPGRAM_API_KEY` | Yes | Deepgram API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `CARTESIA_API_KEY` | Yes | Cartesia API key |
| `DUTCH_VOICE_ID` | No | Custom Cartesia voice for Dutch |
| `ITALIAN_VOICE_ID` | No | Custom Cartesia voice for Italian |

## License

BSD 2-Clause (based on pipecat-examples)
