import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createServer,
  extractAssistantContentFromChatCompletionText,
  extractMacdomCandidatesFromKnowledge,
  normalizeBboxTo1000,
  normalizeMacdomBoundsTo1000,
  requestLooksLikeMidsceneLocate,
  responseUsesMacdomBbox,
} from './wiki-midscene-adapter.mjs';

const MODEL = 'qwen3-vl:8b-instruct-q4_K_M';

function makePngDataUrl(width, height) {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer.write('PNG', 1, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function makeLocateBody(prompt = '春日樱花') {
  return {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: [
          '## Role:',
          'You are an AI assistant that helps identify UI elements.',
          '',
          '## Output Format:',
          '```json',
          '{"bbox": [0, 0, 1000, 1000], "errors": []}',
          '```',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Find: ${prompt}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: makePngDataUrl(1000, 500),
            },
          },
        ],
      },
    ],
  };
}

function makePlanningBody(instruction = '点击打开传输列表') {
  return {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Determine Next Action\n<action-type></action-type>\n<action-param-json></action-param-json>',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<user_instruction>${instruction}</user_instruction>\nNo previous actions have been executed.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: makePngDataUrl(1000, 500),
            },
          },
        ],
      },
    ],
  };
}

function makePlanningBodyWithImageSize(
  instruction = '点击打开传输列表',
  imageSize = { width: 1000, height: 500 },
) {
  const body = makePlanningBody(instruction);
  body.messages[1].content[1].image_url.url = makePngDataUrl(
    imageSize.width,
    imageSize.height,
  );
  return body;
}

function makeKnowledge() {
  return [
    'Claude 已通过 kbgraph MCP 为本次 Midscene 规划查询到以下页面路径/控件定位依据。',
    '',
    '精修界面/页面控件/顶部栏-页签栏/子控件/精修页签/子控件/创意页面/子控件/创意页面_AI工具工作区/子页面/WeatherGenerateAttributeBlock/页面控件/天气属性页根容器/子控件/子天气风格列表区/子控件/春日樱花',
    '控制类型: 卡片',
    '操作能力: 点击',
    '定位候选: objectName=WeatherGenerateAttributeBlock',
    '别名: 春日樱花',
    '直接子控件: 无',
  ].join('\n');
}

function adapterOptions(overrides = {}) {
  const knowledge = makeKnowledge();
  return {
    target: 'http://127.0.0.1:9/v1',
    model: '',
    enabled: false,
    logRequests: false,
    debug: false,
    timeoutMs: 5000,
    queryTermModel: '',
    queryTermModelMaxTokens: 192,
    macdomLocate: true,
    macdomMode: 'builtin',
    macdomRepo: '',
    macdomBaseUrl: 'http://localhost:3511',
    macdomScreenSize: undefined,
    macdomTimeoutMs: 1000,
    macdomDebug: false,
    macdomCandidateModelEnabled: false,
    macdomCandidateModel: '',
    macdomCandidateLimit: 8,
    macdomCandidateCache: new Map(),
    latestPlanningContext: {
      instruction: '生成春日樱花',
      terms: ['生成春日樱花'],
      knowledge,
      candidates: extractMacdomCandidatesFromKnowledge(knowledge),
      updatedAt: Date.now(),
    },
    ...overrides,
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createFakeMacdomHttpServer(xml = '<root />') {
  return http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(xml);
  });
}

async function createFakeMacdomRepo(scriptBody) {
  const repo = await mkdtemp(join(tmpdir(), 'midscene-macdom-'));
  const scriptDir = join(repo, '.agents/skills/macdom/scripts');
  await mkdir(scriptDir, { recursive: true });
  await writeFile(
    join(scriptDir, 'macdom_dispatch.py'),
    ['#!/usr/bin/env python3', scriptBody, ''].join('\n'),
    'utf8',
  );
  return repo;
}

test('recognizes Midscene locate chat completion requests', () => {
  assert.equal(requestLooksLikeMidsceneLocate(makeLocateBody()), true);
});

test('extracts MacDOM candidates from Claude/kbgraph knowledge', () => {
  const candidates = extractMacdomCandidatesFromKnowledge(makeKnowledge());
  const textIndex = candidates.findIndex(
    (candidate) => candidate.text === '春日樱花',
  );
  const objectNameIndex = candidates.findIndex(
    (candidate) => candidate.object_name === 'WeatherGenerateAttributeBlock',
  );

  assert.notEqual(textIndex, -1);
  assert.notEqual(objectNameIndex, -1);
  assert.ok(textIndex < objectNameIndex);
});

test('cleans noisy MacDOM locator values from knowledge', () => {
  const candidates = extractMacdomCandidatesFromKnowledge(
    [
      '顶部栏-传输列表，控件定位依据：className=CountIndicatorButton和objectName=btnTransportListButton识别。',
      '主定位：className=CountIndicatorButton, objectName=btnTransportListButton, toolTip="传输列表 查看上传、下载任务"。',
    ].join('\n'),
  );

  assert.ok(
    candidates.some(
      (candidate) => candidate.object_name === 'btnTransportListButton',
    ),
  );
  assert.ok(
    candidates.some(
      (candidate) => candidate.class_name === 'CountIndicatorButton',
    ),
  );
  assert.ok(
    candidates.some(
      (candidate) => candidate.tool_tip === '传输列表 查看上传、下载任务',
    ),
  );
});

test('normalizes MacDOM bounds to qwen3-vl 0-1000 bbox', () => {
  assert.deepEqual(
    normalizeBboxTo1000(
      { x: 100, y: 50, width: 200, height: 100 },
      { width: 1000, height: 500 },
    ),
    [100, 100, 300, 300],
  );
});

test('normalizes MacDOM logical screen bounds into model-image bbox', () => {
  assert.deepEqual(
    normalizeMacdomBoundsTo1000(
      { x: 1418, y: 33, width: 40, height: 40 },
      { width: 1920, height: 1247 },
      {
        type: 'screen-logical',
        size: { width: 1512, height: 982 },
        source: 'configured',
      },
    ),
    [938, 34, 964, 74],
  );
});

test('extracts assistant content from OpenAI-compatible chat completion text', () => {
  const content = '<action-type>Tap</action-type>';
  assert.equal(
    extractAssistantContentFromChatCompletionText(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content,
            },
          },
        ],
      }),
    ),
    content,
  );
});

test('detects MacDOM bbox usage in planning action params', () => {
  const responseText = JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: [
            '<action-type>Tap</action-type>',
            '<action-param-json>',
            '{"locate":{"prompt":"传输列表","bbox":[739,26,759,59]}}',
            '</action-param-json>',
          ].join('\n'),
        },
      },
    ],
  });

  assert.deepEqual(
    responseUsesMacdomBbox(responseText, [739, 26, 759, 59]).used,
    true,
  );
  assert.equal(
    responseUsesMacdomBbox(responseText, [739, 26, 759, 59]).reason,
    'bbox_match',
  );
});

test('detects MacDOM center point usage in planning action params', () => {
  const responseText = JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content:
            '<action-param-json>{"locate":{"prompt":"传输列表","point":[749,43]}}</action-param-json>',
        },
      },
    ],
  });

  assert.deepEqual(responseUsesMacdomBbox(responseText, [739, 26, 759, 59]), {
    used: true,
    reason: 'point_match',
    matchedPayload: [749, 43],
    content:
      '<action-param-json>{"locate":{"prompt":"传输列表","point":[749,43]}}</action-param-json>',
  });
});

test('returns a MacDOM locate response without forwarding on hit', async () => {
  let targetHits = 0;
  const target = http.createServer((_req, res) => {
    targetHits += 1;
    res.end('{}');
  });
  const macdomHttp = createFakeMacdomHttpServer(
    '<root><Card text="春日樱花" isInVisibleRect="true" absX="100" absY="50" width="200" height="100" /></root>',
  );
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      macdomBaseUrl: macdomBase,
      macdomScreenSize: { width: 1000, height: 500 },
    }),
  );

  try {
    await listen(target);
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeLocateBody()),
    });
    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);

    assert.equal(response.status, 200);
    assert.deepEqual(content, { bbox: [100, 100, 300, 300], errors: [] });
    assert.equal(data.model, MODEL);
    assert.equal(targetHits, 0);
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});

test('supports legacy Python MacDOM mode explicitly', async () => {
  const repo = await createFakeMacdomRepo(`
import json
import sys

if "--text" in sys.argv and sys.argv[sys.argv.index("--text") + 1] == "春日樱花":
    payload = {"success": True, "props": {"visible": True, "bounds": {"x": 100, "y": 50, "width": 200, "height": 100}}}
else:
    payload = {"success": False, "props": {"visible": False}}

print(json.dumps(payload, ensure_ascii=False))
`);
  let targetHits = 0;
  const target = http.createServer((_req, res) => {
    targetHits += 1;
    res.end('{}');
  });
  const adapter = createServer(
    adapterOptions({
      macdomMode: 'python',
      macdomRepo: repo,
      macdomScreenSize: { width: 1000, height: 500 },
    }),
  );

  try {
    await listen(target);
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeLocateBody()),
    });
    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);

    assert.equal(response.status, 200);
    assert.deepEqual(content, { bbox: [100, 100, 300, 300], errors: [] });
    assert.equal(targetHits, 0);
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      rm(repo, { recursive: true, force: true }),
    ]);
  }
});

test('injects MacDOM coordinates into planning requests', async () => {
  let forwardedBody;
  const target = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwardedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'planning-response',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<action-type>Tap</action-type>',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const targetBase = await listen(target);
  const macdomHttp = createFakeMacdomHttpServer(
    '<root><Button text="点击打开传输列表" isInVisibleRect="true" absX="400" absY="20" width="100" height="40" /></root>',
  );
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      target: `${targetBase}/v1`,
      enabled: false,
      macdomBaseUrl: macdomBase,
      macdomScreenSize: { width: 1000, height: 500 },
    }),
  );

  try {
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makePlanningBody()),
    });
    const data = await response.json();
    const forwardedText = JSON.stringify(forwardedBody);

    assert.equal(response.status, 200);
    assert.equal(data.id, 'planning-response');
    assert.match(forwardedText, /MacDOM 当前界面实时定位到以下控件坐标/);
    assert.match(
      forwardedText,
      /qwen3-vl normalized bbox: \[400, 40, 500, 120\]/,
    );
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});

test('injects MacDOM logical-screen coordinates as model-image bbox', async () => {
  let forwardedBody;
  const target = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwardedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'planning-response',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<action-type>Tap</action-type>',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const targetBase = await listen(target);
  const macdomHttp = createFakeMacdomHttpServer(
    '<root><CountIndicatorButton objectName="btnTransportListButton" toolTip="传输列表&#10;查看上传、下载任务" isInVisibleRect="true" absX="1418" absY="33" width="40" height="40" /></root>',
  );
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      target: `${targetBase}/v1`,
      enabled: false,
      macdomBaseUrl: macdomBase,
      macdomScreenSize: { width: 1512, height: 982 },
    }),
  );

  try {
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        makePlanningBodyWithImageSize('点击打开传输列表', {
          width: 1920,
          height: 1247,
        }),
      ),
    });
    const data = await response.json();
    const forwardedText = JSON.stringify(forwardedBody);

    assert.equal(response.status, 200);
    assert.equal(data.id, 'planning-response');
    assert.match(
      forwardedText,
      /MacDOM bounds coordinate space: screen-logical \(1512x982, configured\)/,
    );
    assert.match(
      forwardedText,
      /qwen3-vl normalized bbox: \[938, 34, 964, 74\]/,
    );
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});

test('uses model-generated MacDOM candidates before regex fallbacks', async () => {
  const knowledge = [
    'Claude 已通过 kbgraph MCP 为本次 Midscene 规划查询到以下页面路径/控件定位依据。',
    '顶部按钮-传输列表，控件名：顶部按钮-传输列表，objectName：btnTransportListButton，controlType：按钮，abilities：点击。',
  ].join('\n');
  let forwardedBody;
  const target = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    if (
      body.messages?.some((message) =>
        String(message.content || '').includes('MacDOM 控件定位候选生成器'),
      )
    ) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '["传输列表"]',
              },
            },
          ],
        }),
      );
      return;
    }

    forwardedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'planning-response',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<action-type>Tap</action-type>',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const targetBase = await listen(target);
  const macdomHttp = createFakeMacdomHttpServer(
    '<root><CountIndicatorButton text="传输列表" objectName="btnTransportListButton" isInVisibleRect="true" absX="700" absY="20" width="40" height="40" /><CountIndicatorButton objectName="btnTransportListButton" isInVisibleRect="true" absX="400" absY="20" width="100" height="40" /></root>',
  );
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      target: `${targetBase}/v1`,
      enabled: false,
      macdomBaseUrl: macdomBase,
      macdomScreenSize: { width: 1000, height: 500 },
      macdomCandidateModelEnabled: true,
      latestPlanningContext: {
        instruction: '点击打开传输列表',
        terms: ['点击打开传输列表'],
        knowledge,
        candidates: extractMacdomCandidatesFromKnowledge(knowledge),
        updatedAt: Date.now(),
      },
    }),
  );

  try {
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makePlanningBody()),
    });
    const data = await response.json();
    const forwardedText = JSON.stringify(forwardedBody);

    assert.equal(response.status, 200);
    assert.equal(data.id, 'planning-response');
    assert.match(forwardedText, /候选: text=传输列表/);
    assert.match(
      forwardedText,
      /qwen3-vl normalized bbox: \[700, 40, 740, 120\]/,
    );
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});

test('falls back to visible-tree contains matching for tooltip text', async () => {
  let forwardedBody;
  const target = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwardedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'planning-response',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<action-type>Tap</action-type>',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const targetBase = await listen(target);
  const macdomHttp = createFakeMacdomHttpServer(
    '<root><CountIndicatorButton objectName="btnTransportListButton" toolTip="传输列表&#10;查看上传、下载任务" isInVisibleRect="true" absX="1418" absY="33" width="40" height="40" /></root>',
  );
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      target: `${targetBase}/v1`,
      enabled: false,
      macdomBaseUrl: macdomBase,
      macdomScreenSize: { width: 1512, height: 982 },
      latestPlanningContext: {
        instruction: '点击打开传输列表',
        terms: ['点击打开传输列表'],
        knowledge:
          '主定位：className=CountIndicatorButton, objectName=btnTransportListButton, toolTip="传输列表 查看上传、下载任务"。',
        candidates: [
          {
            tool_tip: '传输列表 查看上传、下载任务',
            object_name: 'btnTransportListButton',
          },
        ],
        updatedAt: Date.now(),
      },
    }),
  );

  try {
    const adapterBase = await listen(adapter);
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        makePlanningBodyWithImageSize('点击打开传输列表', {
          width: 1920,
          height: 1247,
        }),
      ),
    });
    const data = await response.json();
    const forwardedText = JSON.stringify(forwardedBody);

    assert.equal(response.status, 200);
    assert.equal(data.id, 'planning-response');
    assert.match(forwardedText, /候选: text=传输列表/);
    assert.match(forwardedText, /MacDOM match mode: visible-tree-contains/);
    assert.match(
      forwardedText,
      /qwen3-vl normalized bbox: \[938, 34, 964, 74\]/,
    );
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});

test('forwards the original locate request when MacDOM misses', async () => {
  let targetHits = 0;
  let forwardedBody;
  const target = http.createServer(async (req, res) => {
    targetHits += 1;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwardedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'target-response',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '{"bbox":[1,2,3,4],"errors":[]}',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  const targetBase = await listen(target);
  const macdomHttp = createFakeMacdomHttpServer('<root />');
  const macdomBase = await listen(macdomHttp);
  const adapter = createServer(
    adapterOptions({
      target: `${targetBase}/v1`,
      macdomBaseUrl: macdomBase,
    }),
  );

  try {
    const adapterBase = await listen(adapter);
    const requestBody = makeLocateBody();
    const response = await fetch(`${adapterBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.id, 'target-response');
    assert.equal(targetHits, 1);
    assert.deepEqual(forwardedBody, requestBody);
  } finally {
    await Promise.allSettled([
      closeServer(adapter),
      closeServer(target),
      closeServer(macdomHttp),
    ]);
  }
});
