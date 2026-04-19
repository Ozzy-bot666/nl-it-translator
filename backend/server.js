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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RETELL_API_KEY = process.env.RETELL_API_KEY;

// ============ DEBUG LOGGING SYSTEM ============
const DEBUG_LOG = [];
const MAX_LOG_ENTRIES = 200;

function debugLog(category, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data: data ? JSON.stringify(data).slice(0, 500) : null
  };
  DEBUG_LOG.unshift(entry);
  if (DEBUG_LOG.length > MAX_LOG_ENTRIES) DEBUG_LOG.pop();
  console.log(`[${entry.timestamp}] [${category}] ${message}`, data ? JSON.stringify(data).slice(0, 200) : '');
}

// ============ WEBSOCKET SERVER ============
// Note: Retell connects to /llm-websocket/{call_id}
// We need to handle dynamic paths, so we use noServer mode
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade manually to support /llm-websocket/{call_id}
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  debugLog('WS_UPGRADE', `Upgrade request for: ${pathname}`);
  
  if (pathname.startsWith('/llm-websocket')) {
    // Extract call_id from path (e.g., /llm-websocket/call_abc123)
    const callId = pathname.split('/')[2] || 'unknown';
    debugLog('WS_UPGRADE', `Accepting connection for call: ${callId}`);
    
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.callId = callId; // Attach call_id to the websocket
      wss.emit('connection', ws, request);
    });
  } else {
    debugLog('WS_UPGRADE', `Rejected - path doesn't match /llm-websocket/*`);
    socket.destroy();
  }
});

// ============ ENDPOINTS ============

// Health check
app.get('/', (req, res) => {
  debugLog('HTTP', 'Health check hit');
  res.json({ 
    status: 'ok', 
    service: 'nl-it-translator',
    uptime: process.uptime(),
    wsConnections: wss.clients.size
  });
});

// Debug logs endpoint
app.get('/debug', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    totalEntries: DEBUG_LOG.length,
    wsConnections: wss.clients.size,
    uptime: process.uptime(),
    logs: DEBUG_LOG.slice(0, limit)
  });
});

// Clear debug logs
app.post('/debug/clear', (req, res) => {
  DEBUG_LOG.length = 0;
  debugLog('DEBUG', 'Logs cleared');
  res.json({ status: 'cleared' });
});

// Get Retell web call token
app.post('/get-call-token', async (req, res) => {
  debugLog('HTTP', 'Token request received', req.body);
  try {
    const { agent_id } = req.body;
    
    debugLog('RETELL_API', 'Creating web call', { agent_id });
    
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
      debugLog('RETELL_API', 'ERROR creating call', { status: response.status, error });
      return res.status(500).json({ error: 'Failed to create call' });
    }
    
    const data = await response.json();
    debugLog('RETELL_API', 'Call created successfully', { call_id: data.call_id });
    res.json({ access_token: data.access_token, call_id: data.call_id });
    
  } catch (error) {
    debugLog('RETELL_API', 'EXCEPTION', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============ WEBSOCKET HANDLER ============

wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).slice(2, 8);
  debugLog('WS', `Client connected: ${clientId}`, { 
    url: req.url,
    headers: {
      origin: req.headers.origin,
      'user-agent': req.headers['user-agent']?.slice(0, 50)
    }
  });
  
  // Send initial config
  const configMsg = {
    response_type: 'config',
    config: {
      auto_reconnect: true,
      call_details: false,
    }
  };
  ws.send(JSON.stringify(configMsg));
  debugLog('WS', `Sent config to ${clientId}`, configMsg);
  
  // Send empty begin message (agent waits for user)
  const beginMsg = {
    response_type: 'response',
    response_id: 0,
    content: '',
    content_complete: true,
  };
  ws.send(JSON.stringify(beginMsg));
  debugLog('WS', `Sent begin message to ${clientId}`, beginMsg);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      debugLog('WS_IN', `[${clientId}] ${data.interaction_type}`, {
        response_id: data.response_id,
        transcript_length: data.transcript?.length
      });

      // Ping pong for connection keep-alive
      if (data.interaction_type === 'ping_pong') {
        const pong = { response_type: 'ping_pong', timestamp: Date.now() };
        ws.send(JSON.stringify(pong));
        debugLog('WS_OUT', `[${clientId}] pong`);
        return;
      }

      // Update only - no response needed
      if (data.interaction_type === 'update_only') {
        debugLog('WS', `[${clientId}] update_only (no action)`);
        return;
      }

      // User finished speaking - translate
      if (data.interaction_type === 'response_required' || data.interaction_type === 'reminder_required') {
        const responseId = data.response_id;
        
        // Extract text from transcript array
        const transcriptArray = data.transcript || [];
        const lastUtterance = transcriptArray[transcriptArray.length - 1];
        const userText = lastUtterance?.content || '';
        
        debugLog('WS', `[${clientId}] User text extracted`, { 
          text: userText.slice(0, 100),
          utterances: transcriptArray.length,
          response_id: responseId
        });
        
        if (userText.trim() === '') {
          const emptyResponse = {
            response_type: 'response',
            response_id: responseId,
            content: '',
            content_complete: true,
          };
          ws.send(JSON.stringify(emptyResponse));
          debugLog('WS_OUT', `[${clientId}] Empty response sent`);
          return;
        }

        // Translate
        debugLog('TRANSLATE', `[${clientId}] Starting translation`, { text: userText.slice(0, 50) });
        const startTime = Date.now();
        
        const translation = await translateText(userText);
        
        const duration = Date.now() - startTime;
        debugLog('TRANSLATE', `[${clientId}] Translation complete`, { 
          duration_ms: duration,
          result: translation.slice(0, 100)
        });

        const response = {
          response_type: 'response',
          response_id: responseId,
          content: translation,
          content_complete: true,
        };
        ws.send(JSON.stringify(response));
        debugLog('WS_OUT', `[${clientId}] Response sent`, { response_id: responseId });
      }
    } catch (error) {
      debugLog('WS_ERROR', `[${clientId}] Error processing message`, { error: error.message });
      try {
        ws.send(JSON.stringify({
          response_type: 'response',
          response_id: 0,
          content: 'Vertaalfout.',
          content_complete: true,
        }));
      } catch (e) {
        debugLog('WS_ERROR', `[${clientId}] Failed to send error response`);
      }
    }
  });

  ws.on('close', (code, reason) => {
    debugLog('WS', `Client disconnected: ${clientId}`, { code, reason: reason.toString() });
  });

  ws.on('error', (error) => {
    debugLog('WS_ERROR', `[${clientId}] WebSocket error`, { error: error.message });
  });
});

// Log when new WS connection attempt happens
wss.on('headers', (headers, req) => {
  debugLog('WS', 'WebSocket upgrade request', { url: req.url });
});

// ============ TRANSLATION ============

async function translateText(text) {
  const systemPrompt = `You are a real-time translator between Dutch and Italian.

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

// ============ STARTUP ============

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  debugLog('SERVER', `Started on port ${PORT}`);
  debugLog('SERVER', `WebSocket path: /llm-websocket`);
  debugLog('SERVER', `Debug endpoint: /debug`);
});
