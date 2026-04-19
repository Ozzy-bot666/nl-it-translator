const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { WebSocketServer } = require('ws');
const http = require('http');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/llm-websocket' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RETELL_API_KEY = process.env.RETELL_API_KEY;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'nl-it-translator' });
});

// Get Retell web call token
app.post('/get-call-token', async (req, res) => {
  try {
    const { agent_id } = req.body;
    
    const response = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Retell API error:', error);
      return res.status(500).json({ error: 'Failed to create call' });
    }
    
    const data = await response.json();
    res.json({ access_token: data.access_token, call_id: data.call_id });
    
  } catch (error) {
    console.error('Error creating call:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket handler for Retell Custom LLM
wss.on('connection', (ws, req) => {
  console.log('Retell WebSocket connected');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received:', data.interaction_type, data.transcript?.slice(0, 50));

      // Ping pong for connection keep-alive
      if (data.interaction_type === 'ping_pong') {
        ws.send(JSON.stringify({ 
          response_type: 'ping_pong',
          timestamp: Date.now()
        }));
        return;
      }

      // Call started - silent greeting
      if (data.interaction_type === 'call_details') {
        ws.send(JSON.stringify({
          response_type: 'response',
          content: '',
          content_complete: true,
        }));
        return;
      }

      // Update only - acknowledge
      if (data.interaction_type === 'update_only') {
        return;
      }

      // User finished speaking - translate
      if (data.interaction_type === 'response_required' || data.interaction_type === 'reminder_required') {
        const transcript = data.transcript || '';
        
        if (transcript.trim() === '') {
          ws.send(JSON.stringify({
            response_type: 'response',
            content: '',
            content_complete: true,
          }));
          return;
        }

        // Translate
        const translation = await translateText(transcript);
        console.log('Translation:', transcript.slice(0, 30), '->', translation.slice(0, 30));

        ws.send(JSON.stringify({
          response_type: 'response',
          content: translation,
          content_complete: true,
        }));
      }
    } catch (error) {
      console.error('WS error:', error);
      ws.send(JSON.stringify({
        response_type: 'response',
        content: 'Er ging iets mis.',
        content_complete: true,
      }));
    }
  });

  ws.on('close', () => {
    console.log('Retell WebSocket disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

async function translateText(text) {
  const systemPrompt = `You are a translator between Dutch and Italian.

RULES:
1. Detect the input language (Dutch or Italian)
2. Translate to the OTHER language
3. Return ONLY the translation, nothing else
4. Keep the same tone and style
5. If unclear, assume Dutch input and translate to Italian

Examples:
- "Hallo, hoe gaat het?" → "Ciao, come stai?"
- "Buongiorno, come sta?" → "Goedemorgen, hoe gaat het?"
- "Ik wil graag een koffie" → "Vorrei un caffè"
- "Quanto costa questo?" → "Hoeveel kost dit?"`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    max_tokens: 500,
    temperature: 0.3,
  });

  return response.choices[0].message.content.trim();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`NL-IT Translator running on port ${PORT}`);
  console.log(`WebSocket: wss://[host]/llm-websocket`);
});
