const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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
      body: JSON.stringify({
        agent_id: agent_id,
      }),
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

// Retell Custom LLM webhook
// https://docs.retellai.com/build-custom-llm/websocket-custom-llm
app.post('/llm-webhook', async (req, res) => {
  try {
    const { transcript, interaction_type } = req.body;
    
    console.log('Received:', { interaction_type, transcript });

    // Handle different interaction types
    if (interaction_type === 'ping_pong') {
      return res.json({ response_type: 'ping_pong' });
    }

    if (interaction_type === 'call_details') {
      // Initial call setup - give brief instruction
      return res.json({
        response_type: 'response',
        content: '',  // Silent start, wait for user input
      });
    }

    if (interaction_type === 'update_only') {
      return res.json({ response_type: 'update_only' });
    }

    // Main translation logic
    if (!transcript || transcript.trim() === '') {
      return res.json({
        response_type: 'response',
        content: '',
      });
    }

    // Detect language and translate
    const translation = await translateText(transcript);
    
    console.log('Translation:', translation);

    res.json({
      response_type: 'response',
      content: translation,
    });
  } catch (error) {
    console.error('Error:', error);
    res.json({
      response_type: 'response',
      content: 'Sorry, er ging iets mis met de vertaling.',
    });
  }
});

async function translateText(text) {
  const systemPrompt = `You are a translator between Dutch and Italian.

RULES:
1. Detect the input language (Dutch or Italian)
2. Translate to the OTHER language
3. Return ONLY the translation, nothing else
4. Keep the same tone and style
5. If the input is neither Dutch nor Italian, translate it to both languages briefly

Examples:
- Input: "Hallo, hoe gaat het?" → Output: "Ciao, come stai?"
- Input: "Buongiorno, come sta?" → Output: "Goedemorgen, hoe gaat het?"
- Input: "Ik wil graag een koffie" → Output: "Vorrei un caffè"
- Input: "Quanto costa questo?" → Output: "Hoeveel kost dit?"`;

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

// WebSocket endpoint for Retell (if needed)
app.ws?.('/llm-websocket/:call_id', (ws, req) => {
  console.log('WebSocket connected:', req.params.call_id);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WS received:', data);
      
      if (data.interaction_type === 'ping_pong') {
        ws.send(JSON.stringify({ response_type: 'ping_pong' }));
        return;
      }
      
      if (data.transcript) {
        const translation = await translateText(data.transcript);
        ws.send(JSON.stringify({
          response_type: 'response',
          content: translation,
        }));
      }
    } catch (error) {
      console.error('WS error:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NL-IT Translator backend running on port ${PORT}`);
});
