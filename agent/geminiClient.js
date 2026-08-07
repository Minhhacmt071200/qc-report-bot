// agent/geminiClient.js
// Gọi Gemini API (generateContent), có hỗ trợ function calling (tools).
// Hàm callGemini() nhận messages/tools theo format giống OpenAI để phần
// còn lại của code (server.js) không cần đổi nhiều - file này lo việc
// chuyển đổi qua lại giữa 2 định dạng.

const fetch = require('node-fetch');

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ];
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

function convertMessages(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text: m.content }] };
    } else if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        contents.push({
          role: 'model',
          parts: m.tool_calls.map((tc) => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            },
          })),
        });
      } else {
        contents.push({ role: 'model', parts: [{ text: m.content || '' }] });
      }
    } else if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.name || 'tool_result',
              response: safeParse(m.content),
            },
          },
        ],
      });
    }
  }
  return { systemInstruction, contents };
}

async function callGemini(messages, tools = []) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const { systemInstruction, contents } = convertMessages(messages);

  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const geminiTools = convertTools(tools);
  if (geminiTools) body.tools = geminiTools;

  const res = await fetch(GEMINI_URL(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API lỗi (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];

  const textPart = parts.find((p) => p.text);
  const functionCalls = parts.filter((p) => p.functionCall);

  if (functionCalls.length > 0) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: functionCalls.map((p, i) => ({
        id: `call_${Date.now()}_${i}`,
        type: 'function',
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      })),
    };
  }

  return { role: 'assistant', content: textPart ? textPart.text : '' };
}

module.exports = { callGemini };
