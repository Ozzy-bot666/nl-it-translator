# NL-IT Voice Translator 🇳🇱 ↔ 🇮🇹

Real-time voice translation between Dutch and Italian using Retell AI.

## How it works

1. User holds push-to-talk button and speaks (Dutch or Italian)
2. Retell STT transcribes the speech
3. Backend detects language and translates via GPT-4
4. Retell TTS speaks the translation

## Architecture

```
[Browser + PTT] → [Retell AI] → [Backend LLM Webhook] → [OpenAI Translate]
                      ↓
              [Retell TTS Output]
```

## Setup

### 1. Create Retell Agent

1. Go to https://app.retellai.com
2. Create new agent
3. Set LLM to "Custom LLM"
4. Set webhook URL to: `https://nl-it-translator-backend.onrender.com/llm-webhook`
5. Copy the Agent ID

### 2. Backend (.env)

```
OPENAI_API_KEY=sk-your-key
RETELL_API_KEY=your-retell-key
```

### 3. Frontend

Update `RETELL_AGENT_ID` in `index.html`

## Deploy

### Backend (Render)
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Root dir: `backend`

### Frontend (Render Static)
- Publish dir: `frontend`

## Usage

1. Open the web app
2. Click the microphone to connect
3. Hold button and speak Dutch or Italian
4. Release to hear translation
