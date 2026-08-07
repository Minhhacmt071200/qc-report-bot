// agent/groqClient.js
const fetch = require('node-fetch');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function callGroq(messages, tools = []) {
  const body = {
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.3,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API lỗi (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message;
}

module.exports = { callGroq };
