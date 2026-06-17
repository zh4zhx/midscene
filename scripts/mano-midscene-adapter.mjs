#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  annotateRects,
  imageInfoOfBase64,
  resizeImgBase64,
  saveBase64Image,
} from '../packages/shared/dist/es/img/index.mjs';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18080;
const DEFAULT_TARGET = 'http://127.0.0.1:8080/v1';
const DEFAULT_VLM_SERVICE_TARGET = 'http://127.0.0.1:8000/v1';
const DEFAULT_LOCAL_TARGET = 'http://127.0.0.1:53111';
const DEFAULT_BACKEND = (
  process.env.MANO_MIDSCENE_BACKEND || 'vlm-service'
).toLowerCase();
const MANO_SCREENSHOT_WIDTH = Number(
  process.env.MANO_MIDSCENE_SCREENSHOT_WIDTH || 1920,
);
const MANO_LOCAL_EXECUTOR_WIDTH = Number(
  process.env.MANO_LOCAL_EXECUTOR_WIDTH || 1280,
);
const MANO_LOCAL_EXECUTOR_HEIGHT = Number(
  process.env.MANO_LOCAL_EXECUTOR_HEIGHT || 720,
);
const MANO_MIDSCENE_SCREEN_WIDTH = Number(
  process.env.MANO_MIDSCENE_SCREEN_WIDTH || 0,
);
const MANO_MIDSCENE_SCREEN_HEIGHT = Number(
  process.env.MANO_MIDSCENE_SCREEN_HEIGHT || 0,
);
const MANO_MIDSCENE_COORDINATE_SCALE = Number(
  process.env.MANO_MIDSCENE_COORDINATE_SCALE || 0,
);
const MANO_PROMPT_MODE = (
  process.env.MANO_MIDSCENE_PROMPT_MODE || 'official'
).toLowerCase();
const MANO_PLANNING_MAX_TOKENS = Number(
  process.env.MANO_MIDSCENE_PLANNING_MAX_TOKENS || 512,
);
const MANO_REPEAT_ACTION_COMPLETE_THRESHOLD = Number(
  process.env.MANO_MIDSCENE_REPEAT_ACTION_COMPLETE_THRESHOLD || 3,
);
const MANO_ENABLE_THINKING = process.env.MANO_MIDSCENE_ENABLE_THINKING === '1';
const MANO_INCLUDE_ACTION_HISTORY =
  process.env.MANO_MIDSCENE_INCLUDE_HISTORY !== '0';
const MANO_DUMP_DIR =
  process.env.MANO_MIDSCENE_ADAPTER_DUMP_DIR ||
  path.resolve('midscene_run/mano-adapter-dump');
const MANO_DUMP_ENABLED = process.env.MANO_MIDSCENE_ADAPTER_DUMP !== '0';
const DEFAULT_MODEL =
  process.env.MANO_MODEL ||
  process.env.MODEL ||
  '/Users/test/.cache/modelscope/hub/models/Mininglamp2718/Mano-CUA-4B-Thinking-1.1-MLX-8bit';

const MANO_LOCATE_OUTPUT_CONTRACT = `
IMPORTANT: You are Mano-CUA behind a Midscene locate adapter.
The user asks you to find one UI element in the screenshot.
Return exactly one action in this format and no Markdown:
<action>click(start_box='<|box_start|>(x,y)<|box_end|>')</action>

Use normalized screenshot coordinates where top-left is (0,0) and bottom-right
is (1000,1000). If the element is not visible, return:
{"point":[],"errors":["target element not found"]}
`.trim();

const MANO_LOCAL_SYSTEM_PROMPT = 'You are a helpful assistant.';
const MANO_COMPACT_SYSTEM_PROMPT = MANO_LOCAL_SYSTEM_PROMPT;

const MANO_COMPACT_INSTRUCTION_TEMPLATE = `
请根据截图完成任务，只输出下面三个 XML 标签，不要输出 Markdown 或额外说明：
<think>简短说明你看到的目标和下一步</think>
<action_desp>动作描述</action_desp>
<action>具体动作</action>

动作格式：
- click(start_box='<|box_start|>(x,y)<|box_end|>')
- doubleclick(start_box='<|box_start|>(x,y)<|box_end|>')
- right_single(start_box='<|box_start|>(x,y)<|box_end|>')
- hover(start_box='<|box_start|>(x,y)<|box_end|>')
- drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x2,y2)<|box_end|>')
- scroll(start_box='<|box_start|>(x,y)<|box_end|>', direction='down/up/left/right', amount='1')
- type(content='要输入的文本')
- hotkey(key='command+n')
- wait(duration='1')
- finish()
- stop(reason='原因')

坐标规则：
- 使用当前截图的归一化坐标，范围 0 到 1000。
- 左上角是 (0,0)，右下角是 (1000,1000)。
- 点击控件时给控件中心点，不要给边缘点。
- 用户只要求点击时，只输出 click，不要提前 finish。

任务：{task}
历史：{actionHistory}
{actionContextBlock}
当前截图为<image>
`.trim();

const MANO_MODELSCOPE_INSTRUCTION_TEMPLATE = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
<action>action</action>

## Action Space
open_app(app_name='') # Open an application by name.
open_url(url='') # Open a URL in the browser.
click(start_box='<|box_start|>(x1,y1)<|box_end|>')
type(content='') # type the content.
hotkey(key='') # Trigger a keyboard shortcut.
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up or right or left', amount='scroll_amount')
drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>')
wait(duration='') # Sleep for specified duration (in seconds).
finish() # The task is completed.
stop(reason='') # If the item can not found in the image, give the reason

## User Instruction
{instruction}`;

const MANO_LOCAL_INSTRUCTION_TEMPLATE = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
<think>思考过程</think>
<action_desp>动作描述</action_desp>
<action>具体动作</action>

## Action Space

open_app(app_name='') # Open an application by name.
open_url(url='') # Open a URL in the browser.
hover(start_box='<|box_start|>(x1,y1)<|box_end|>')
click(start_box='<|box_start|>(x1,y1)<|box_end|>')
triple_click(start_box='<|box_start|>(x1,y1)<|box_end|>') left click at the coordinate (x1,y1) three times
hotkey_click(start_box='<|box_start|>(x1,y1)<|box_end|>', key=''). press command key and click at the coordinate (x1,y1)
right_single(start_box='<|box_start|>(x1,y1)<|box_end|>').  right click at the coordinate (x1,y1)
type(content='') type the content.
doubleclick(start_box='<|box_start|>(x1,y1)<|box_end|>')
drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>') # Drag an element from the start coordinate (x1,y1) to the end coordinate (x3,y3).
hotkey(key='') # Trigger a keyboard shortcut.
wait(duration='') # Sleep for specified duration (in seconds) and take a screenshot to check for any changes.
call_user() # Request human assistance
stop(reason='') # If the item can not found in the image, give the reason
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up or right or left', amount='scroll_amount') # Scroll on the specified direction at the coordinate (x1,y1) by the given amount
finish() # The task is completed.

## Note
- Use Chinese in \`<think>\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`<action_desp>\` part.
- If the user explicitly requests a keyboard shortcut such as command/cmd/ctrl/shift/alt + key, use \`hotkey(key='...')\` first unless the screenshot clearly shows that the shortcut has already been used or failed.
- For \`type(content='...')\`, the content must be the exact literal text to input. Preserve Chinese characters, English letters, numbers, spaces, and punctuation exactly as requested. Never transliterate to pinyin, never paraphrase, and never substitute with similar words.
- If an input box already contains unrelated text and the task is to search or replace it, clear the existing text before typing the new content.
- Only choose a search result or feature when the visible text on screen matches the user goal or is an obvious exact follow-up. Do not infer that an unrelated result is correct.
- If a group is already expanded and its child controls are visible, do not click the group header again and collapse it.
- When the task names an exact slider/control label, operate only the row whose visible label exactly matches that name. Do not confuse a parent summary slider with similarly named child sliders.
- Do not output \`finish()\` unless the exact target control visibly satisfies the requested end state.
- If the current subtask is already satisfied in the screenshot, immediately proceed to the next remaining subtask. Do not wait unless the UI is visibly loading or changing.
- If the current subtask contains an explicit shortcut or explicit literal input text, output that exact shortcut/text literally.

## User Instruction:
{instruction}

`;

function parseArgs(argv) {
  const options = {
    host: process.env.MANO_MIDSCENE_ADAPTER_HOST || DEFAULT_HOST,
    port: Number(process.env.MANO_MIDSCENE_ADAPTER_PORT || DEFAULT_PORT),
    backend: DEFAULT_BACKEND,
    target:
      process.env.MANO_MODEL_BASE_URL ||
      process.env.MANO_LOCAL_SERVICE_BASE_URL ||
      (DEFAULT_BACKEND === 'mano-local'
        ? DEFAULT_LOCAL_TARGET
        : DEFAULT_BACKEND === 'vlm-service'
          ? DEFAULT_VLM_SERVICE_TARGET
          : DEFAULT_TARGET),
    model: DEFAULT_MODEL,
    localToken: process.env.MANO_LOCAL_SERVICE_TOKEN,
    debug: process.env.MANO_MIDSCENE_ADAPTER_DEBUG === '1',
  };
  let targetSpecified = Boolean(
    process.env.MANO_MODEL_BASE_URL || process.env.MANO_LOCAL_SERVICE_BASE_URL,
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [key, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;

    if (key === 'backend') options.backend = String(value).toLowerCase();
    if (key === 'host') options.host = value;
    if (key === 'port') options.port = Number(value);
    if (key === 'target') {
      options.target = value;
      targetSpecified = true;
    }
    if (key === 'model') options.model = value;
    if (key === 'local-token') options.localToken = value;
    if (key === 'debug') options.debug = value !== 'false';
  }

  if (!targetSpecified && options.backend === 'mano-local') {
    options.target = DEFAULT_LOCAL_TARGET;
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  if (!['mlx-openai', 'vlm-service', 'mano-local'].includes(options.backend)) {
    throw new Error(
      `Invalid backend: ${options.backend}. Expected "mlx-openai", "vlm-service", or "mano-local".`,
    );
  }

  return {
    ...options,
    target: stripTrailingSlash(options.target),
  };
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function assertLocalModelPathForMlxOpenai(options) {
  if (!['mlx-openai', 'vlm-service'].includes(options.backend)) return;
  const model = String(options.model || '');
  if (path.isAbsolute(model) || model.startsWith('~')) return;

  throw new Error(
    `Invalid Mano model path for ${options.backend} backend: ${model}. Use a local absolute model path, for example /Users/test/.cache/modelscope/hub/models/Mininglamp2718/Mano-CUA-4B-Thinking-1.1-MLX-8bit.`,
  );
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON request body: ${error.message}`);
  }
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function isChatCompletionsPath(pathname) {
  const normalized = normalizePath(pathname);
  return (
    normalized === '/v1/chat/completions' || normalized === '/chat/completions'
  );
}

function isModelsPath(pathname) {
  const normalized = normalizePath(pathname);
  return normalized === '/v1/models' || normalized === '/models';
}

function buildTargetUrl(targetBase, pathname) {
  const normalized = normalizePath(pathname);
  const targetPath = normalized.startsWith('/v1/')
    ? normalized.slice('/v1'.length)
    : normalized;

  return `${targetBase}${targetPath}`;
}

function stringifyForLog(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function truncateForLog(value, limitOverride) {
  const text = String(value || '');
  const limit = Number(
    limitOverride ?? process.env.MANO_MIDSCENE_ADAPTER_LOG_TEXT_LIMIT ?? 12000,
  );
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n... <truncated ${text.length - limit} chars>`;
}

function imageUrlsFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => imageUrlFromContentPart(part))
    .filter((url) => typeof url === 'string');
}

function dataUrlFromBase64Payload(base64Payload, mimeType = 'image/png') {
  if (typeof base64Payload !== 'string' || !base64Payload) return undefined;
  return `data:${mimeType};base64,${base64Payload}`;
}

function imageUrlFromContentPart(part) {
  if (typeof part?.image_url?.url === 'string') {
    return part.image_url.url;
  }

  if (typeof part?.image_url === 'string') {
    return part.image_url;
  }

  return undefined;
}

function base64PayloadFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return undefined;
  const match = dataUrl.match(/^data:image\/[^;,]+;base64,([\s\S]+)$/i);
  return match?.[1];
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function imagePartsFromMessages(messages) {
  const imageParts = [];
  for (const [messageIndex, message] of messages.entries()) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const [contentIndex, part] of content.entries()) {
      const url = imageUrlFromContentPart(part);
      if (typeof url !== 'string') continue;

      imageParts.push({
        messageIndex,
        contentIndex,
        role: message?.role,
        type: part?.type,
        url,
      });
    }
  }

  return imageParts;
}

function latestImageUrlFromMessages(messages) {
  const imagePart = latestImagePartFromMessages(messages);
  return imagePart?.image_url?.url;
}

async function saveDebugImage(imageUrl, outputPath) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) {
    return false;
  }

  await saveBase64Image({
    base64Data: imageUrl,
    outputPath,
  });
  return true;
}

function normalizedPointToPixel(point, imageInfo) {
  if (!point || !imageInfo?.width || !imageInfo?.height) return undefined;
  return [
    Math.round((point[0] * Math.max(imageInfo.width - 1, 0)) / 1000),
    Math.round((point[1] * Math.max(imageInfo.height - 1, 0)) / 1000),
  ];
}

function pointToPixelBbox(point, imageInfo, halfSize = 3) {
  const pixelPoint = normalizedPointToPixel(point, imageInfo);
  if (!pixelPoint || !imageInfo?.width || !imageInfo?.height) return undefined;

  const [x, y] = pixelPoint;
  const maxX = Math.max(imageInfo.width - 1, 0);
  const maxY = Math.max(imageInfo.height - 1, 0);
  return [
    Math.max(0, x - halfSize),
    Math.max(0, y - halfSize),
    Math.min(maxX, x + halfSize),
    Math.min(maxY, y + halfSize),
  ];
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function estimateRetinaLogicalPoint(pixelPoint) {
  if (!pixelPoint) return undefined;
  return [Math.round(pixelPoint[0] / 2), Math.round(pixelPoint[1] / 2)];
}

function normalizedPointToManoExecutor(point) {
  if (!point) return undefined;
  return [
    Math.round((point[0] / 1000) * MANO_LOCAL_EXECUTOR_WIDTH),
    Math.round((point[1] / 1000) * MANO_LOCAL_EXECUTOR_HEIGHT),
  ];
}

let cachedLocalScreenSize;
function getLocalScreenSize() {
  if (cachedLocalScreenSize !== undefined) return cachedLocalScreenSize;

  if (
    Number.isFinite(MANO_MIDSCENE_SCREEN_WIDTH) &&
    MANO_MIDSCENE_SCREEN_WIDTH > 0 &&
    Number.isFinite(MANO_MIDSCENE_SCREEN_HEIGHT) &&
    MANO_MIDSCENE_SCREEN_HEIGHT > 0
  ) {
    cachedLocalScreenSize = {
      width: MANO_MIDSCENE_SCREEN_WIDTH,
      height: MANO_MIDSCENE_SCREEN_HEIGHT,
      source: 'env',
    };
    return cachedLocalScreenSize;
  }

  try {
    const require = createRequire(
      pathToFileURL(path.resolve('packages/computer/package.json')),
    );
    const { libnut } = require('@computer-use/libnut/dist/import_libnut');
    const size = libnut?.getScreenSize?.();
    if (size?.width > 0 && size?.height > 0) {
      cachedLocalScreenSize = {
        width: Number(size.width),
        height: Number(size.height),
        source: 'libnut',
      };
      return cachedLocalScreenSize;
    }
  } catch {}

  cachedLocalScreenSize = undefined;
  return cachedLocalScreenSize;
}

function inferCoordinateScale({ originalSize, screenSize }) {
  if (
    Number.isFinite(MANO_MIDSCENE_COORDINATE_SCALE) &&
    MANO_MIDSCENE_COORDINATE_SCALE > 0
  ) {
    return {
      x: MANO_MIDSCENE_COORDINATE_SCALE,
      y: MANO_MIDSCENE_COORDINATE_SCALE,
      source: 'env',
    };
  }

  if (
    originalSize?.width > 0 &&
    originalSize?.height > 0 &&
    screenSize?.width > 0 &&
    screenSize?.height > 0
  ) {
    return {
      x: originalSize.width / screenSize.width,
      y: originalSize.height / screenSize.height,
      source: screenSize.source || 'screen-size',
    };
  }

  return { x: 1, y: 1, source: 'identity' };
}

function normalizeManoPointToScreenPoint(point, coordinateContext = {}) {
  if (!point) return undefined;
  const originalSize = coordinateContext.originalSize;
  const screenSize =
    coordinateContext.midsceneScreenSize || getLocalScreenSize();
  const scale = inferCoordinateScale({ originalSize, screenSize });
  const physicalPoint = normalizedPointToPixel(point, originalSize);

  if (physicalPoint && scale.x > 0 && scale.y > 0) {
    return {
      point: [
        Math.round(physicalPoint[0] / scale.x),
        Math.round(physicalPoint[1] / scale.y),
      ],
      source: `original/${scale.source}`,
      physicalPoint,
      screenSize,
      scale,
    };
  }

  const executorPoint = normalizedPointToManoExecutor(point);
  if (!executorPoint) return undefined;

  return {
    point: executorPoint,
    source: 'mano-executor',
    physicalPoint: undefined,
    screenSize,
    scale,
  };
}

function pointToScreenBbox(point, coordinateContext = {}, halfSize = 3) {
  const mapped = normalizeManoPointToScreenPoint(point, coordinateContext);
  if (!mapped?.point) return undefined;

  const screenSize = mapped.screenSize;
  const [x, y] = mapped.point;
  const maxX =
    screenSize?.width > 0 ? Math.max(0, Math.round(screenSize.width - 1)) : x;
  const maxY =
    screenSize?.height > 0 ? Math.max(0, Math.round(screenSize.height - 1)) : y;

  return {
    bbox: [
      clampNumber(x - halfSize, 0, maxX),
      clampNumber(y - halfSize, 0, maxY),
      clampNumber(x + halfSize, 0, maxX),
      clampNumber(y + halfSize, 0, maxY),
    ],
    ...mapped,
  };
}

function rectAroundPoint(point, imageInfo, halfSize = 18) {
  if (!point || !imageInfo?.width || !imageInfo?.height) return undefined;
  const [x, y] = point;
  const left = Math.max(0, x - halfSize);
  const top = Math.max(0, y - halfSize);
  const right = Math.min(imageInfo.width - 1, x + halfSize);
  const bottom = Math.min(imageInfo.height - 1, y + halfSize);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

async function saveMarkedPointImage({ imageUrl, point, outputPath, prompt }) {
  if (
    typeof imageUrl !== 'string' ||
    !imageUrl.startsWith('data:image/') ||
    !point
  ) {
    return false;
  }

  const info = await imageInfoOfBase64(imageUrl);
  const pixelPoint = normalizedPointToPixel(point, info);
  const rect = rectAroundPoint(pixelPoint, info);
  if (!rect) return false;

  const marked = await annotateRects(imageUrl, [rect], prompt);
  const markedBase64 =
    typeof marked === 'string' ? marked : marked?.compositeElementInfoImgBase64;
  if (typeof markedBase64 !== 'string') {
    throw new Error(
      `annotateRects returned no base64 image: ${JSON.stringify(marked)}`,
    );
  }

  await saveBase64Image({
    base64Data: markedBase64,
    outputPath,
  });
  return true;
}

async function describeImageUrlForLog(url) {
  if (!url.startsWith('data:image/')) {
    return {
      kind: 'url',
      preview: truncateForLog(url),
    };
  }

  try {
    const info = await imageInfoOfBase64(url);
    return {
      kind: 'data-url',
      width: info?.width,
      height: info?.height,
      chars: url.length,
    };
  } catch (error) {
    return {
      kind: 'data-url',
      error: error instanceof Error ? error.message : String(error),
      chars: url.length,
    };
  }
}

async function logRequestSummary(label, body, options = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const topLevelImages = Array.isArray(body?.images) ? body.images : [];
  const messageSummaries = await Promise.all(
    messages.map(async (message, index) => {
      const text = contentToText(message?.content);
      const imageUrls = imageUrlsFromContent(message?.content);
      const omitText = options.omitSystemText && message?.role === 'system';
      return {
        index,
        role: message?.role,
        textLength: text.length,
        text: omitText
          ? `<omitted system prompt, ${text.length} chars>`
          : truncateForLog(text, options.textLimit),
        images: await Promise.all(imageUrls.map(describeImageUrlForLog)),
      };
    }),
  );
  const topLevelImageSummaries = await Promise.all(
    topLevelImages.map(async (image, index) => {
      const dataUrl =
        typeof image === 'string' && image.startsWith('data:image/')
          ? image
          : dataUrlFromBase64Payload(image);
      const info = dataUrl ? await imageInfoOfBase64(dataUrl) : undefined;
      return {
        index,
        kind:
          typeof image === 'string' && image.startsWith('data:image/')
            ? 'data-url'
            : 'base64',
        chars: typeof image === 'string' ? image.length : undefined,
        sha256: typeof image === 'string' ? hashText(image) : undefined,
        width: info?.width,
        height: info?.height,
      };
    }),
  );

  console.log(
    `[mano-midscene-adapter] ${label}:`,
    stringifyForLog({
      model: body?.model,
      temperature: body?.temperature,
      top_p: body?.top_p,
      max_tokens: body?.max_tokens,
      resize_shape: body?.resize_shape,
      enable_thinking: body?.enable_thinking,
      images: topLevelImageSummaries,
      messages: messageSummaries,
    }),
  );
}

async function resizeImageUrlForMano(imageUrl, debug) {
  if (
    typeof imageUrl !== 'string' ||
    !imageUrl.startsWith('data:image/') ||
    !Number.isFinite(MANO_SCREENSHOT_WIDTH) ||
    MANO_SCREENSHOT_WIDTH <= 0
  ) {
    return imageUrl;
  }

  const info = await imageInfoOfBase64(imageUrl);
  if (!info?.width || !info?.height || info.width <= MANO_SCREENSHOT_WIDTH) {
    if (debug) {
      console.log('[mano-midscene-adapter] image unchanged:', info);
    }
    return imageUrl;
  }

  const targetHeight = Math.round(
    (info.height * MANO_SCREENSHOT_WIDTH) / info.width,
  );
  const resized = await resizeImgBase64(imageUrl, {
    width: MANO_SCREENSHOT_WIDTH,
    height: targetHeight,
  });

  if (debug) {
    console.log('[mano-midscene-adapter] resized image for Mano:', {
      from: `${info.width}x${info.height}`,
      to: `${MANO_SCREENSHOT_WIDTH}x${targetHeight}`,
    });
  }

  return resized;
}

async function resizeImagesForMano(body, debug) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let changed = false;

  const nextMessages = await Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message?.content)) {
        return message;
      }

      let messageChanged = false;
      const nextContent = await Promise.all(
        message.content.map(async (part) => {
          const url = part?.image_url?.url;
          if (typeof url !== 'string') {
            return part;
          }

          const resizedUrl = await resizeImageUrlForMano(url, debug);
          if (resizedUrl === url) {
            return part;
          }

          messageChanged = true;
          changed = true;
          return {
            ...part,
            image_url: {
              ...part.image_url,
              url: resizedUrl,
            },
          };
        }),
      );

      return messageChanged
        ? {
            ...message,
            content: nextContent,
          }
        : message;
    }),
  );

  return changed
    ? {
        ...body,
        messages: nextMessages,
      }
    : body;
}

async function resizeTopLevelImagesForMano(body, debug) {
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!images.length) return body;

  let changed = false;
  const nextImages = await Promise.all(
    images.map(async (image) => {
      const dataUrl =
        typeof image === 'string' && image.startsWith('data:image/')
          ? image
          : dataUrlFromBase64Payload(image);
      if (!dataUrl) return image;

      const resizedDataUrl = await resizeImageUrlForMano(dataUrl, debug);
      const resizedPayload = base64PayloadFromDataUrl(resizedDataUrl);
      if (!resizedPayload || resizedPayload === image) return image;

      changed = true;
      return resizedPayload;
    }),
  );

  return changed
    ? {
        ...body,
        images: nextImages,
      }
    : body;
}

let debugDumpCounter = 0;

function nextDumpPrefix(responseMode) {
  debugDumpCounter += 1;
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d+Z$/, 'Z');
  return `${timestamp}-${String(debugDumpCounter).padStart(4, '0')}-${responseMode}`;
}

async function dumpManoRequestImages({
  originalBody,
  manoBody,
  responseMode,
  debug,
}) {
  if (!debug || !MANO_DUMP_ENABLED) return undefined;

  const originalMessages = Array.isArray(originalBody?.messages)
    ? originalBody.messages
    : [];
  const manoMessages = Array.isArray(manoBody?.messages)
    ? manoBody.messages
    : [];
  const originalImageUrl = latestImageUrlFromMessages(originalMessages);
  const forwardedImageUrl =
    latestImageUrlFromMessages(manoMessages) ||
    dataUrlFromBase64Payload(
      Array.isArray(manoBody?.images) ? manoBody.images.at(-1) : undefined,
    );
  if (!originalImageUrl && !forwardedImageUrl) return undefined;

  await mkdir(MANO_DUMP_DIR, { recursive: true });
  const prefix = nextDumpPrefix(responseMode);
  const paths = {
    original: path.join(MANO_DUMP_DIR, `${prefix}-original.png`),
    forwarded: path.join(MANO_DUMP_DIR, `${prefix}-forwarded-to-mano.png`),
    coords: path.join(MANO_DUMP_DIR, `${prefix}-coords.json`),
    markedOriginal: path.join(MANO_DUMP_DIR, `${prefix}-marked-original.png`),
    markedForwarded: path.join(MANO_DUMP_DIR, `${prefix}-marked-forwarded.png`),
  };

  const originalSaved = await saveDebugImage(originalImageUrl, paths.original);
  const forwardedSaved = await saveDebugImage(
    forwardedImageUrl,
    paths.forwarded,
  );
  const originalInfo = originalImageUrl?.startsWith('data:image/')
    ? await imageInfoOfBase64(originalImageUrl)
    : undefined;
  const forwardedInfo = forwardedImageUrl?.startsWith('data:image/')
    ? await imageInfoOfBase64(forwardedImageUrl)
    : undefined;

  const dump = {
    prefix,
    originalImage: originalSaved ? paths.original : undefined,
    forwardedImage: forwardedSaved ? paths.forwarded : undefined,
    originalSize: originalInfo,
    forwardedSize: forwardedInfo,
  };

  console.log(
    '[mano-midscene-adapter] image dump:',
    stringifyForLog({
      originalImage: dump.originalImage,
      forwardedImage: dump.forwardedImage,
      originalSize: dump.originalSize,
      forwardedSize: dump.forwardedSize,
    }),
  );

  return {
    ...dump,
    paths,
    originalImageUrl,
    forwardedImageUrl,
  };
}

function responseHeadersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

async function buildOutgoingImageProof(body, serializedBody) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const imageParts = imagePartsFromMessages(messages);
  const topLevelImages = Array.isArray(body?.images) ? body.images : [];

  const messageProof = await Promise.all(
    imageParts.map(async (part) => {
      const isDataUrl = part.url.startsWith('data:image/');
      const info = isDataUrl ? await imageInfoOfBase64(part.url) : undefined;
      return {
        source: 'message',
        messageIndex: part.messageIndex,
        contentIndex: part.contentIndex,
        role: part.role,
        type: part.type,
        isDataUrl,
        includedInSerializedBody: serializedBody.includes(part.url),
        chars: part.url.length,
        sha256: hashText(part.url),
        width: info?.width,
        height: info?.height,
      };
    }),
  );

  const topLevelProof = await Promise.all(
    topLevelImages.map(async (image, index) => {
      const dataUrl =
        typeof image === 'string' && image.startsWith('data:image/')
          ? image
          : dataUrlFromBase64Payload(image);
      const info = dataUrl ? await imageInfoOfBase64(dataUrl) : undefined;
      return {
        source: 'images',
        imageIndex: index,
        isDataUrl: typeof image === 'string' && image.startsWith('data:image/'),
        includedInSerializedBody: serializedBody.includes(String(image)),
        chars: typeof image === 'string' ? image.length : undefined,
        sha256: typeof image === 'string' ? hashText(image) : undefined,
        width: info?.width,
        height: info?.height,
      };
    }),
  );

  return [...messageProof, ...topLevelProof];
}

async function assertAndLogOutgoingManoImages(body, serializedBody, debug) {
  const imageProof = await buildOutgoingImageProof(body, serializedBody);
  const missingFromSerializedBody = imageProof.filter(
    (item) => !item.includedInSerializedBody,
  );

  if (!imageProof.length) {
    throw new Error(
      'Mano request has no image content. Refusing to call Mano without a screenshot.',
    );
  }

  if (missingFromSerializedBody.length) {
    throw new Error(
      `Mano request image content exists in object but is missing from serialized HTTP body: ${JSON.stringify(
        missingFromSerializedBody,
      )}`,
    );
  }

  if (debug) {
    console.log(
      '[mano-midscene-adapter] outgoing Mano HTTP body image proof:',
      stringifyForLog({
        serializedBodyChars: serializedBody.length,
        imageCount: imageProof.length,
        images: imageProof,
      }),
    );
  }
}

function logManoResponse({ targetUrl, response, rawText, parsedData }) {
  console.log('[mano-midscene-adapter] Mano response url:', targetUrl);
  console.log('[mano-midscene-adapter] Mano response status:', response.status);
  console.log(
    '[mano-midscene-adapter] Mano response headers:',
    stringifyForLog(responseHeadersToObject(response.headers)),
  );
  console.log('[mano-midscene-adapter] Mano response raw body:', rawText);
  if (parsedData !== undefined) {
    console.log(
      '[mano-midscene-adapter] Mano response parsed json:',
      stringifyForLog(parsedData),
    );
  }
}

async function forwardToMano({ target, pathname, body, headers, debug }) {
  const targetUrl = buildTargetUrl(target, pathname);
  const serializedBody = JSON.stringify(body);
  await assertAndLogOutgoingManoImages(body, serializedBody, debug);

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: headers.authorization || 'Bearer local',
    },
    body: serializedBody,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    logManoResponse({
      targetUrl,
      response,
      rawText: text,
    });
    throw new Error(
      `Mano returned non-JSON response (${response.status}): ${text.slice(
        0,
        500,
      )}`,
    );
  }

  logManoResponse({
    targetUrl,
    response,
    rawText: text,
    parsedData: data,
  });

  if (!response.ok) {
    const message = data?.detail || data?.error?.message || response.statusText;
    throw new Error(`Mano request failed (${response.status}): ${message}`);
  }

  return data;
}

function actionHistorySignatureFromRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages
    .filter((message) => message?.role === 'assistant')
    .map((message) => contentToText(message.content))
    .join('\n---\n');
}

function createManoLocalState() {
  return {
    signature: undefined,
    sessionId: undefined,
    lastToolUseId: undefined,
  };
}

function buildManoLocalUrl(targetBase, pathname) {
  return `${targetBase}${pathname}`;
}

function buildManoLocalHeaders(options) {
  return {
    'content-type': 'application/json',
    ...(options.localToken
      ? {
          'x-mano-local-token': options.localToken,
        }
      : {}),
  };
}

async function callManoLocalService({ options, method, pathname, payload }) {
  const targetUrl = buildManoLocalUrl(options.target, pathname);
  const response = await fetch(targetUrl, {
    method,
    headers: buildManoLocalHeaders(options),
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(
      `Mano local service returned non-JSON response (${response.status}): ${text.slice(
        0,
        500,
      )}`,
    );
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(
      `Mano local service request failed (${response.status}): ${
        data?.detail || response.statusText
      }`,
    );
  }

  return data;
}

async function closeManoLocalSession(options) {
  if (!options.localState?.sessionId) return;
  const sessionId = options.localState.sessionId;
  try {
    await callManoLocalService({
      options,
      method: 'POST',
      pathname: `/v1/local/sessions/${sessionId}/close`,
      payload: {},
    });
  } catch (error) {
    if (options.debug) {
      console.warn(
        '[mano-midscene-adapter] failed to close Mano local session:',
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    options.localState.sessionId = undefined;
    options.localState.lastToolUseId = undefined;
  }
}

async function ensureManoLocalSession({ options, requestBody }) {
  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const task = extractMidsceneUserInstruction(messages);
  const actionContext = extractMidsceneActionContext(messages);
  const hasMidsceneActionHistory = messages.some(
    (message) => message?.role === 'assistant',
  );
  const signature = JSON.stringify({
    model: requestBody.model || options.model,
    task,
    actionContext,
  });

  if (
    hasMidsceneActionHistory &&
    options.localState?.sessionId &&
    options.localState.signature === signature
  ) {
    return {
      sessionId: options.localState.sessionId,
      task,
      actionContext,
      created: false,
    };
  }

  await closeManoLocalSession(options);

  const payload = {
    task: actionContext ? `${task}\n\n高优先级信息：\n${actionContext}` : task,
    requested_model_path: requestBody.model || options.model,
  };
  const data = await callManoLocalService({
    options,
    method: 'POST',
    pathname: '/v1/local/sessions',
    payload,
  });

  options.localState.signature = signature;
  options.localState.sessionId = data.session_id;
  options.localState.lastToolUseId = undefined;

  return {
    sessionId: data.session_id,
    task,
    actionContext,
    created: true,
  };
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function latestImagePartFromMessages(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;

    for (let j = content.length - 1; j >= 0; j -= 1) {
      const part = content[j];
      if (typeof part?.image_url?.url === 'string') {
        return structuredClone(part);
      }
    }
  }

  return undefined;
}

function latestImageBase64FromMessages(messages) {
  const imageUrl = latestImageUrlFromMessages(messages);
  return base64PayloadFromDataUrl(imageUrl);
}

function extractLastAssistantAction(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;

    const text = contentToText(message.content);
    const log = extractTaggedContent(text, 'log');
    const actionType = extractTaggedContent(text, 'action-type');
    if (log || actionType) {
      return {
        log: xmlUnescape(log || ''),
        actionType: xmlUnescape(actionType || 'unknown'),
      };
    }
  }

  return undefined;
}

function buildManoLocalToolResults({ requestBody, screenshotBase64, options }) {
  const historySignature = actionHistorySignatureFromRequest(requestBody);
  const lastAction = extractLastAssistantAction(
    Array.isArray(requestBody?.messages) ? requestBody.messages : [],
  );
  const toolUseIdSource =
    historySignature || `initial-screenshot:${hashText(screenshotBase64)}`;
  options.localState.lastToolUseId = toolUseIdSource;

  return [
    {
      tool_use_id: hashText(toolUseIdSource).slice(0, 16),
      status: 'success',
      output: lastAction
        ? `${lastAction.actionType} ok: ${lastAction.log}`
        : 'current Midscene screenshot',
      error: null,
      include_screenshot: Boolean(screenshotBase64),
      ...(screenshotBase64 ? { screenshot_b64: screenshotBase64 } : {}),
    },
  ];
}

function xmlUnescape(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractFirstTagFromTexts(texts, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  for (const text of texts) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return xmlUnescape(match[1].trim());
    }
  }
  return '';
}

function extractMidsceneUserInstruction(messages) {
  const nonSystemTexts = messages
    .filter((message) => message?.role !== 'system')
    .map((message) => contentToText(message.content));
  const taggedInstruction = extractFirstTagFromTexts(
    nonSystemTexts,
    'user_instruction',
  );
  if (taggedInstruction) return taggedInstruction;

  const fallback = nonSystemTexts.find((text) => {
    const trimmed = text.trim();
    return (
      trimmed &&
      !/^This is the current screenshot/i.test(trimmed) &&
      !/^No previous actions/i.test(trimmed) &&
      !/^The previous action has been executed/i.test(trimmed)
    );
  });

  return fallback?.trim() || '请根据当前截图完成用户任务';
}

function extractMidsceneActionContext(messages) {
  const nonSystemTexts = messages
    .filter((message) => message?.role !== 'system')
    .map((message) => contentToText(message.content));
  return extractFirstTagFromTexts(nonSystemTexts, 'high_priority_knowledge');
}

function extractPreviousActionHistory(messages) {
  const summaries = [];
  for (const message of messages) {
    if (message?.role !== 'assistant') continue;

    const text = contentToText(message.content);
    const log = extractTaggedContent(text, 'log');
    const actionType = extractTaggedContent(text, 'action-type');
    const complete = text.match(
      /<complete\s+success="(true|false)">([\s\S]*?)<\/complete>/i,
    );
    const error = extractTaggedContent(text, 'error');

    if (complete) {
      summaries.push({
        action: complete[1] === 'true' ? 'finish' : 'stop',
        desc: xmlUnescape(complete[2]?.trim() || ''),
      });
      continue;
    }

    if (actionType || log) {
      summaries.push({
        action: xmlUnescape(actionType || 'unknown'),
        desc: xmlUnescape(log || actionType || ''),
      });
      continue;
    }

    if (error) {
      summaries.push({
        action: 'error',
        desc: xmlUnescape(error),
      });
    }
  }

  if (!summaries.length) return '无';

  return summaries
    .slice(-4)
    .map((summary, index) => {
      const desc = summary.desc ? `；说明=${summary.desc}` : '';
      return `第${index + 1}步：动作=${summary.action}${desc}`;
    })
    .join('\n');
}

function previousActionSummaries(messages) {
  const summaries = [];
  for (const message of messages) {
    if (message?.role !== 'assistant') continue;

    const text = contentToText(message.content);
    const log = extractTaggedContent(text, 'log');
    const actionType = extractTaggedContent(text, 'action-type');
    const complete = text.match(
      /<complete\s+success="(true|false)">([\s\S]*?)<\/complete>/i,
    );

    if (complete) {
      summaries.push({
        action: complete[1] === 'true' ? 'finish' : 'stop',
        desc: xmlUnescape(complete[2]?.trim() || ''),
      });
      continue;
    }

    if (actionType || log) {
      summaries.push({
        action: xmlUnescape(actionType || 'unknown'),
        desc: xmlUnescape(log || actionType || ''),
      });
    }
  }
  return summaries;
}

function isClickOnlyInstruction(task) {
  const text = String(task || '').trim();
  if (!text) return false;

  const hasClickIntent =
    /(点击|点按|单击|click|tap|press)/i.test(text) || /^点/.test(text);
  if (!hasClickIntent) return false;

  return !/(输入|填写|键入|保存|提交|确认|创建并|新建并|命名|搜索|选择.+后|type|fill|enter|save|submit|confirm|create.*and|name|search)/i.test(
    text,
  );
}

function hasPreviousPointerAction(messages) {
  return previousActionSummaries(messages).some((summary) =>
    isPointerActionName(summary.action),
  );
}

function extractSearchText(task) {
  const text = String(task || '').trim();
  if (!text) return undefined;

  const patterns = [
    /搜索\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /查找\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /search\s+["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }

  return undefined;
}

function hasPreviousInputValue(messages, value) {
  const expected = String(value || '').trim();
  if (!expected) return false;

  return previousActionSummaries(messages).some((summary) => {
    if (!/^(Input|type)$/i.test(summary.action)) return false;
    return String(summary.desc || '').includes(expected);
  });
}

function actionLooksLikeSearchSubmit(rawAction, coordinateContext = {}) {
  const text = normalizeNaturalLanguageActionText(rawAction);
  if (!text) return false;

  return (
    /(搜索按钮|点击搜索|提交搜索|执行搜索|开始搜索|按回车|回车|enter|press enter|search button|submit search)/i.test(
      text,
    ) ||
    (/(搜索|查找|search)/i.test(text) &&
      /(点击|点按|单击|按|提交|按钮|button|submit)/i.test(text))
  );
}

function taskLooksLikeSearch(task) {
  return /(搜索|查找|search)/i.test(String(task || ''));
}

function shouldCompleteAfterPreviousClick(requestBody, requestMode) {
  if (requestMode !== 'planning') return false;
  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const task = extractMidsceneUserInstruction(messages);
  return isClickOnlyInstruction(task) && hasPreviousPointerAction(messages);
}

function buildCompleteChatCompletionResponse(model, message = 'done') {
  return {
    id: `chatcmpl-mano-adapter-complete-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `<complete success="true">${xmlEscape(message)}</complete>`,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function buildOfficialManoPrompt({ task, actionContext, actionHistory }) {
  const instructionParts = [task];
  if (actionContext) {
    instructionParts.push('');
    instructionParts.push('High priority knowledge:');
    instructionParts.push(actionContext);
  }
  if (MANO_INCLUDE_ACTION_HISTORY && actionHistory) {
    instructionParts.push('');
    instructionParts.push(`Action history: ${actionHistory}`);
  }

  return MANO_MODELSCOPE_INSTRUCTION_TEMPLATE.replace(
    '{instruction}',
    instructionParts.join('\n'),
  );
}

function hasInputIntent(task) {
  return /(输入|填写|填入|键入|命名|名称|type|fill|enter|name)/i.test(
    String(task || ''),
  );
}

function taskNeedsActionAfterInput(task) {
  return /(完成|保存|提交|确认|创建|新建|complete|finish|save|submit|confirm|create|new)/i.test(
    String(task || ''),
  );
}

function isDismissTask(task) {
  return /(关闭|取消|收起|隐藏|退出|关掉|关上|close|cancel|dismiss|collapse|hide|exit)/i.test(
    String(task || ''),
  );
}

function previousHistorySupportsDismissFinish(messages, task) {
  if (!Array.isArray(messages) || !isDismissTask(task)) return false;

  return previousActionSummaries(messages).some((summary) => {
    if (
      isPointerActionName(summary.action) ||
      /^(KeyboardPress|hotkey|Input|type)$/i.test(summary.action)
    ) {
      return true;
    }

    return /(关闭|取消|收起|隐藏|退出|关掉|关上|close|cancel|dismiss|collapse|hide|exit|escape|esc)/i.test(
      summary.desc || '',
    );
  });
}

function normalizeCompletionEvidenceText(value) {
  return xmlUnescape(String(value || ''))
    .toLowerCase()
    .replace(/[“”‘’"'`]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function addCompletionTerm(terms, value) {
  const text = normalizeCompletionEvidenceText(value)
    .replace(
      /^(?:请|请你|先|然后|接着|再|去|打开|关闭|搜索|选择|选中|点击|点按|单击|输入|填写|填入|键入|开启|启用|切换到|切换|进入|按下|按|open|close|search|select|click|tap|type|enable|switchto|switch|enter|press)/i,
      '',
    )
    .replace(/(?:一下|即可|按钮|选项|功能|控件)$/i, '')
    .trim();
  if (text.length < 2) return;

  const stopTerms = new Set([
    '左上',
    '右上',
    '左下',
    '右下',
    '上方',
    '下方',
    '顶部',
    '底部',
    '按钮',
    '选项',
    '功能',
    '控件',
  ]);
  if (!stopTerms.has(text)) {
    terms.add(text);
  }

  for (const ascii of text.match(/[a-z0-9]{2,}/gi) || []) {
    terms.add(ascii.toLowerCase());
  }

  for (const chunk of text.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    if (!stopTerms.has(chunk)) {
      terms.add(chunk);
    }
    if (chunk.length > 2) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        const pair = chunk.slice(index, index + 2);
        if (!stopTerms.has(pair)) {
          terms.add(pair);
        }
      }
    }
  }
}

function extractCompletionTerms(task) {
  const terms = new Set();
  const text = String(task || '').trim();
  if (!text) return [];

  const clauses = text
    .split(/(?:，|,|。|；|;|、|\n|然后|接着|并且|并|and then|then)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    addCompletionTerm(terms, clause);
  }

  const targetPatterns = [
    /搜索\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/gi,
    /选择\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/gi,
    /选中\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/gi,
    /打开\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/gi,
    /点击\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/gi,
  ];
  for (const pattern of targetPatterns) {
    for (const match of text.matchAll(pattern)) {
      addCompletionTerm(terms, match[1]);
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

function previousHistorySupportsTaskFinish(messages, task) {
  if (!Array.isArray(messages)) return false;

  const summaries = previousActionSummaries(messages).filter(
    (summary) => !/^(finish|stop|error)$/i.test(summary.action || ''),
  );
  if (!summaries.length) return false;

  const evidenceText = normalizeCompletionEvidenceText(
    summaries
      .map((summary) => `${summary.action || ''} ${summary.desc || ''}`)
      .join('\n'),
  );
  const terms = extractCompletionTerms(task);
  if (!terms.length) return false;

  const matchedTerms = terms.filter((term) => evidenceText.includes(term));
  const isMultiStepTask =
    /，|,|。|；|;|、|然后|接着|并且|并|and then|then/i.test(
      String(task || ''),
    ) || summaries.length >= 3;
  const requiredMatches = isMultiStepTask
    ? Math.min(3, Math.max(2, Math.ceil(terms.length * 0.35)))
    : 1;

  return matchedTerms.length >= requiredMatches;
}

function previousHistorySupportsGenericFinish(messages, task) {
  if (!Array.isArray(messages) || !hasInputIntent(task)) return false;

  const summaries = previousActionSummaries(messages);
  const lastInputIndex = summaries.findLastIndex((summary) =>
    /^(Input|type)$/i.test(summary.action),
  );
  if (lastInputIndex < 0) return false;

  if (!taskNeedsActionAfterInput(task)) return true;

  return summaries.slice(lastInputIndex + 1).some((summary) => {
    if (isPointerActionName(summary.action)) return true;
    return /(保存|提交|确认|创建|新建|完成|打开|进入|显示|出现|save|submit|confirm|create|new|complete|opened|shown)/i.test(
      summary.desc || '',
    );
  });
}

function normalizeActionSummaryDesc(desc) {
  const text = xmlUnescape(String(desc || ''));
  const point = parseFirstPoint(text);
  if (point) {
    return `point:${Math.round(point[0])},${Math.round(point[1])}`;
  }
  return text
    .replace(/\s+/g, ' ')
    .replace(/[.。；;，,]+$/g, '')
    .trim();
}

function repeatedRecentActionCount(messages) {
  const summaries = previousActionSummaries(messages).filter(
    (summary) => summary.action && summary.action !== 'error',
  );
  if (!summaries.length) return 0;

  const last = summaries.at(-1);
  const lastSignature = `${last.action}:${normalizeActionSummaryDesc(last.desc)}`;
  let count = 0;
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    const summary = summaries[index];
    const signature = `${summary.action}:${normalizeActionSummaryDesc(
      summary.desc,
    )}`;
    if (signature !== lastSignature) break;
    count += 1;
  }
  return count;
}

function shouldCompleteAfterRepeatedNoop(requestBody, requestMode) {
  if (requestMode !== 'planning') return false;
  if (
    !Number.isFinite(MANO_REPEAT_ACTION_COMPLETE_THRESHOLD) ||
    MANO_REPEAT_ACTION_COMPLETE_THRESHOLD <= 0
  ) {
    return false;
  }

  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const task = extractMidsceneUserInstruction(messages);
  const hasTypedSearchTerm =
    taskLooksLikeSearch(task) &&
    hasPreviousInputValue(messages, extractSearchText(task));
  if (
    !hasTypedSearchTerm &&
    !previousHistorySupportsGenericFinish(messages, task)
  ) {
    return false;
  }

  return (
    repeatedRecentActionCount(messages) >= MANO_REPEAT_ACTION_COMPLETE_THRESHOLD
  );
}

function buildCompactManoPrompt({ task, actionContext, actionHistory }) {
  const actionContextBlock = actionContext
    ? `高优先级信息：\n${actionContext}`
    : '';
  return MANO_COMPACT_INSTRUCTION_TEMPLATE.replace('{task}', task)
    .replace('{actionHistory}', actionHistory || '无')
    .replace('{actionContextBlock}', actionContextBlock)
    .trim();
}

function buildManoLocalPrompt({ task, actionContext, actionHistory }) {
  if (MANO_PROMPT_MODE === 'official' || MANO_PROMPT_MODE === 'local-agent') {
    return buildOfficialManoPrompt({ task, actionContext, actionHistory });
  }

  return buildCompactManoPrompt({ task, actionContext, actionHistory });
}

function buildPlanningBodyForMano(body, manoPrompt, latestImagePart, options) {
  const imageUrl = imageUrlFromContentPart(latestImagePart);
  const imagePayload = base64PayloadFromDataUrl(imageUrl);
  const userContent =
    options.backend === 'vlm-service'
      ? `${manoPrompt}\n\n当前截图为<image>`
      : typeof imageUrl === 'string'
        ? [
            {
              type: 'text',
              text: manoPrompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ]
        : manoPrompt;
  const { images: _images, ...bodyWithoutTopLevelImages } = body;
  return {
    ...bodyWithoutTopLevelImages,
    model: options.backend === 'vlm-service' ? 'qwen3-vl' : options.model,
    temperature: 0,
    top_p: 1,
    max_tokens:
      Number.isFinite(MANO_PLANNING_MAX_TOKENS) && MANO_PLANNING_MAX_TOKENS > 0
        ? MANO_PLANNING_MAX_TOKENS
        : body.max_tokens,
    ...(options.backend === 'mlx-openai'
      ? { resize_shape: [MANO_SCREENSHOT_WIDTH, MANO_SCREENSHOT_WIDTH] }
      : {}),
    enable_thinking: MANO_ENABLE_THINKING,
    stream: false,
    ...(options.backend === 'vlm-service' && imagePayload
      ? { images: [imagePayload] }
      : {}),
    messages: [
      {
        role: 'system',
        content: MANO_LOCAL_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
  };
}

function requestLooksLikeMidscenePlanning(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const joinedText = messages
    .map((message) => contentToText(message.content))
    .join('\n');
  const hasImage = messages.some((message) =>
    Array.isArray(message.content)
      ? message.content.some((part) => part?.type === 'image_url')
      : false,
  );

  return (
    hasImage &&
    /<action-type\b|<action-param-json\b|Determine Next Action|No previous actions have been executed/i.test(
      joinedText,
    )
  );
}

function requestLooksLikeMidsceneLocate(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const joinedText = messages
    .map((message) => contentToText(message.content))
    .join('\n');
  const hasImage = messages.some((message) =>
    Array.isArray(message.content)
      ? message.content.some((part) => part?.type === 'image_url')
      : false,
  );

  return (
    hasImage &&
    /"bbox"\s*:|`bbox`|Find:\s*|Identify elements in screenshots|Provide the coordinates of the element/i.test(
      joinedText,
    )
  );
}

function rewriteMidscenePlanningRequestForMano(body, options, debug) {
  if (!requestLooksLikeMidscenePlanning(body)) {
    return body;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const latestImagePart = latestImagePartFromMessages(messages);
  const task = extractMidsceneUserInstruction(messages);
  const actionContext = extractMidsceneActionContext(messages);
  const actionHistory = extractPreviousActionHistory(messages);
  const manoPrompt = buildManoLocalPrompt({
    task,
    actionContext,
    actionHistory,
  });

  if (debug) {
    console.log(
      '[mano-midscene-adapter] rewrote Midscene planning request to Mano prompt',
    );
    console.log(
      '[mano-midscene-adapter] Mano task/history summary:',
      stringifyForLog({
        promptMode: MANO_PROMPT_MODE,
        task,
        hasActionContext: Boolean(actionContext),
        actionHistory,
        hasImage: Boolean(latestImagePart),
        promptLength: manoPrompt.length,
      }),
    );
  }

  return buildPlanningBodyForMano(body, manoPrompt, latestImagePart, options);
}

function appendTextInstruction(content, instruction) {
  if (typeof content === 'string') {
    return `${content}\n\n${instruction}`;
  }

  if (!Array.isArray(content)) {
    return instruction;
  }

  let appended = false;
  const nextContent = content.map((part) => {
    if (!appended && part?.type === 'text' && typeof part.text === 'string') {
      appended = true;
      return {
        ...part,
        text: `${part.text}\n\n${instruction}`,
      };
    }
    return part;
  });

  if (!appended) {
    nextContent.unshift({
      type: 'text',
      text: instruction,
    });
  }

  return nextContent;
}

function injectManoLocateContract(body, debug) {
  if (!requestLooksLikeMidsceneLocate(body)) {
    return body;
  }

  const requestBody = structuredClone(body);
  const messages = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : [];
  let targetIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex >= 0) {
    messages[targetIndex] = {
      ...messages[targetIndex],
      content: appendTextInstruction(
        messages[targetIndex].content,
        MANO_LOCATE_OUTPUT_CONTRACT,
      ),
    };
  } else {
    messages.push({
      role: 'user',
      content: MANO_LOCATE_OUTPUT_CONTRACT,
    });
  }

  requestBody.messages = messages;
  if (debug) {
    console.log('[mano-midscene-adapter] injected Mano locate contract');
  }
  return requestBody;
}

function resolveRequestMode(body) {
  if (requestLooksLikeMidscenePlanning(body)) return 'planning';
  if (requestLooksLikeMidsceneLocate(body)) return 'locate';
  return 'planning';
}

function prepareManoRequestBody(
  body,
  options,
  debug,
  requestMode = resolveRequestMode(body),
) {
  if (requestMode === 'planning') {
    return rewriteMidscenePlanningRequestForMano(body, options, debug);
  }

  if (requestMode === 'locate') {
    return {
      ...injectManoLocateContract(body, debug),
      model: options.model,
    };
  }

  return {
    ...body,
    model: options.model,
  };
}

async function prepareManoRequestBodyForForwarding(
  body,
  options,
  debug,
  requestMode = resolveRequestMode(body),
) {
  const requestBody = prepareManoRequestBody(body, options, debug, requestMode);
  const resizedMessageImages = await resizeImagesForMano(requestBody, debug);
  return resizeTopLevelImagesForMano(resizedMessageImages, debug);
}

function extractTaggedContent(text, tag) {
  const match = text.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  );
  return match?.[1]?.trim();
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseQuotedValue(input, key) {
  const patterns = [
    new RegExp(`${key}\\s*=\\s*'([\\s\\S]*?)'`, 'i'),
    new RegExp(`${key}\\s*=\\s*"([\\s\\S]*?)"`, 'i'),
    new RegExp(`${key}\\s*=\\s*([^,;)\\s]+)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  return undefined;
}

function parsePointFromNamedBox(input, key) {
  const value = parseQuotedValue(input, key);
  const match = (value || input).match(
    /\(?\s*(?:<\|box_start\|>)?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:<\|box_end\|>)?/i,
  );
  if (
    !match ||
    (value === undefined && !new RegExp(`\\b${key}\\b`, 'i').test(input))
  ) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2])];
}

function parseFirstPoint(input) {
  const namedPoint =
    parsePointFromNamedBox(input, 'start_box') ||
    parsePointFromNamedBox(input, 'point') ||
    parsePointFromNamedBox(input, 'coordinate') ||
    parsePointFromNamedBox(input, 'coordinates');

  if (namedPoint) return namedPoint;

  const compactClick = input.match(
    /(?:click|tap|hover|doubleclick|triple_click|right_single|hotkey_click|mouse_move|move)\s*>\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (compactClick) {
    return [Number(compactClick[1]), Number(compactClick[2])];
  }

  const barePoint = input.match(
    /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/,
  );
  if (barePoint) {
    return [Number(barePoint[1]), Number(barePoint[2])];
  }

  return undefined;
}

function parseDragPoints(input) {
  const start = parsePointFromNamedBox(input, 'start_box');
  const end = parsePointFromNamedBox(input, 'end_box');
  if (start && end) return { start, end };

  const numbers = [...input.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  if (numbers.length >= 4) {
    return {
      start: [numbers[0], numbers[1]],
      end: [numbers[2], numbers[3]],
    };
  }

  return undefined;
}

function stripFunctionNoise(input) {
  return input
    .replace(/^[a-z_]+\s*\(/i, '')
    .replace(/\)\s*$/i, '')
    .replace(
      /\b(start_box|end_box|point|coordinate|coordinates|content|key|keyName|duration|direction|amount|app_name|appName|url|reason)\s*=\s*/gi,
      '',
    )
    .replace(/<\|box_start\|>|<\|box_end\|>/g, '')
    .replace(/['"]/g, '')
    .trim();
}

function locateFromPoint(
  point,
  prompt = 'the target position',
  coordinateContext = {},
) {
  const [x, y] = point;
  const locate = {
    prompt,
    point: [Math.round(x), Math.round(y)],
  };

  if (coordinateContext.debug) {
    const screenBbox = pointToScreenBbox(locate.point, coordinateContext);
    console.log(
      '[mano-midscene-adapter] Midscene locate point contract:',
      stringifyForLog({
        sentToMidscene: locate,
        note: 'Only normalized point is sent. Midscene will convert it to screenshot pixels and then to logical click coordinates.',
        executorCoordinateForReference: normalizedPointToManoExecutor(
          locate.point,
        ),
        screenPointForReference: screenBbox?.point,
        screenSizeForReference: screenBbox?.screenSize
          ? {
              width: screenBbox.screenSize.width,
              height: screenBbox.screenSize.height,
              source: screenBbox.screenSize.source,
            }
          : undefined,
        coordinateScaleForReference: screenBbox?.scale,
        coordinateMappingForReference: screenBbox?.source,
        originalPixelPointForReference: screenBbox?.physicalPoint,
      }),
    );
  }

  return locate;
}

function firstChoiceContent(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : '';
}

function extractManoPointFromContent(content) {
  const rawContent = String(content || '').trim();
  const manoAction = extractTaggedContent(rawContent, 'action') || rawContent;
  const point = parseFirstPoint(manoAction);
  return point ? [Math.round(point[0]), Math.round(point[1])] : undefined;
}

function convertKeyName(key) {
  const aliasMap = {
    cmd: 'command',
    command: 'command',
    meta: 'command',
    super: 'command',
    win: 'command',
    ctrl: 'control',
    control: 'control',
    alt: 'alt',
    option: 'alt',
    opt: 'alt',
    shift: 'shift',
    esc: 'escape',
    return: 'enter',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    pgup: 'pageup',
    pgdn: 'pagedown',
    del: 'delete',
  };

  return key
    .replace(/\s*\+\s*/g, '+')
    .trim()
    .split('+')
    .filter(Boolean)
    .map((part) => aliasMap[part.toLowerCase()] || part)
    .join('+');
}

function normalizeActionName(rawAction) {
  const trimmed = rawAction.trim();
  const nameMatch = trimmed.match(/^([a-z_]+)\b/i);
  const name = nameMatch?.[1]?.toLowerCase();

  if (name === 'tap') return 'click';
  if (name === 'double_click') return 'doubleclick';
  if (name === 'rightclick' || name === 'right_click') return 'right_single';
  if (name === 'mouse_move' || name === 'move') return 'hover';
  if (name === 'type_text') return 'type';
  if (name === 'press') return 'hotkey';
  if (name === 'open' || name === 'launch_app') return 'open_app';
  if (name === 'url' || name === 'url_open' || name === 'openurl') {
    return 'open_url';
  }

  return name || '';
}

function isImperativeActionTask(task) {
  const text = String(task || '').trim();
  if (!text) return false;

  return /(点击|点按|单击|双击|右键|悬停|拖动|拖拽|滚动|输入|填写|键入|按下|按住|打开|选择|切换|展开|收起|创建|新建|保存|关闭|确认|取消|删除|上传|下载|登录|搜索|移动|复制|粘贴|click|tap|double\s*click|right\s*click|hover|drag|scroll|type|press|open|select|switch|expand|create|new|save|close|confirm|cancel|delete|upload|download|login|search|move|copy|paste)/i.test(
    text,
  );
}

function isPointerActionName(actionName) {
  return /^(Tap|DoubleClick|TripleClick|RightClick|Hover|HotkeyClick|click|tap|doubleclick|triple_click|right_single|hover|hotkey_click)$/i.test(
    String(actionName || ''),
  );
}

function completionTextLooksGeneric(value) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return true;

  return /^(finish|done|complete|completed|success|ok|任务已完成|完成|已完成|操作完成|结束)$/i.test(
    text,
  );
}

function completionTextHasVisibleProof(value) {
  const text = String(value || '').trim();
  if (!text) return false;

  return /(成功|已成功|已经|弹出|打开|进入|显示|出现|可见|完成|对话框|窗口|页面|界面|successfully|succeeded|visible|shown|opened|dialog|window|page|screen|completed)/i.test(
    text,
  );
}

function shouldRejectImperativeFinish({
  task,
  thought,
  actionDescription,
  message,
  previousMessages,
}) {
  if (!isImperativeActionTask(task)) return false;
  if (previousHistorySupportsDismissFinish(previousMessages, task)) {
    return false;
  }
  if (previousHistorySupportsTaskFinish(previousMessages, task)) {
    return false;
  }
  if (previousHistorySupportsGenericFinish(previousMessages, task)) {
    return false;
  }

  const completionText = [thought, actionDescription, message]
    .filter(Boolean)
    .join('\n');

  return (
    completionTextLooksGeneric(completionText) ||
    !completionTextHasVisibleProof(completionText)
  );
}

function parseLooseParams(input) {
  if (!input.includes(';')) return {};

  const params = {};
  const parts = input
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts.slice(1)) {
    const [key, ...valueParts] = part.split('=');
    if (!key || valueParts.length === 0) continue;
    params[key.trim().toLowerCase()] = valueParts
      .join('=')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return params;
}

function parseNumberParam(input, keys, fallback) {
  for (const key of keys) {
    const value = parseQuotedValue(input, key) || parseLooseParams(input)[key];
    if (value !== undefined) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function splitManoActions(rawAction) {
  const input = String(rawAction || '').trim();
  if (!input) return [];

  const pattern =
    /\b(open_app|open_url|click|doubleclick|double_click|triple_click|right_single|rightclick|right_click|hover|hotkey_click|type|type_text|hotkey|press|scroll|drag|wait|finish|done|stop|fail|call_user)\s*\([\s\S]*?\)/gi;
  const actions = [];
  for (const match of input.matchAll(pattern)) {
    actions.push(match[0].trim());
  }
  return actions.length ? actions : [input];
}

function firstActionByName(rawAction, names) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  return splitManoActions(rawAction).find((action) =>
    normalizedNames.has(normalizeActionName(action)),
  );
}

function looksLikeStructuredAction(action) {
  const text = String(action || '').trim();
  if (!text) return false;

  return /^[a-z_]+\s*\(/i.test(text) || /^[a-z_]+\s*>/i.test(text);
}

function firstPointerAction(rawAction) {
  return firstActionByName(rawAction, [
    'click',
    'tap',
    'doubleclick',
    'double_click',
    'triple_click',
    'right_single',
    'rightclick',
    'right_click',
    'hover',
    'hotkey_click',
  ])?.trim();
}

function extractRequestedInputText(task) {
  const text = String(task || '').trim();
  if (!text) return undefined;

  const patterns = [
    /输入\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /填写\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /键入\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /type\s+["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /enter\s+["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }

  return undefined;
}

function chooseInputValueFromAction(action, coordinateContext = {}) {
  const value =
    parseQuotedValue(action, 'content') ||
    parseQuotedValue(action, 'text') ||
    parseQuotedValue(action, 'value') ||
    '';
  const requestedValue = extractRequestedInputText(coordinateContext.task);

  if (
    requestedValue &&
    (!value ||
      requestedValue === value ||
      requestedValue.includes(value) ||
      value.includes(requestedValue))
  ) {
    return requestedValue;
  }

  return value;
}

function extractNaturalLanguageInputValue(action, coordinateContext = {}) {
  const text = String(action || '').trim();
  if (!text) return undefined;

  if (firstPointerAction(text)) return undefined;
  if (/输入\s*(框|栏|区域|位置|控件|field|box|area)/i.test(text)) {
    return undefined;
  }

  const requestedValue = extractRequestedInputText(coordinateContext.task);
  const patterns = [
    /(?:(?:项目名称|名称)\s*)?(?:设置为|设为|命名为)\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /(?:项目名称|名称)\s*(?:[:：=]|为|是)\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /(?:输入|填写|填入|键入)(?![了过])\s*["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
    /(?:set|type|enter)\s+["'“”‘’]?([^"'“”‘’，,。；;\n]+)["'“”‘’]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]
      ?.trim()
      .replace(/[.。；;，,]+$/g, '')
      .trim();
    if (value) return requestedValue || value;
  }

  return undefined;
}

function normalizeNaturalLanguageActionText(action) {
  return xmlUnescape(String(action || ''))
    .replace(/<\/?(?:action|action_desp|log|think|thought)[^>]*>/gi, ' ')
    .replace(/^[\s\-*•]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.。；;，,]+$/g, '')
    .trim();
}

function normalizeLocatePrompt(prompt) {
  return String(prompt || '')
    .replace(/^[\s\-*•]+/g, '')
    .replace(/^(?:请|请你|先|然后|接着|下一步|现在|当前)?\s*/i, '')
    .replace(
      /^(?:去)?(?:点击|点按|单击|双击|右键点击|右键|打开|展开|选中|选择|切换到|切到|进入|按下|按|click|tap|double\s*click|right\s*click|open|expand|select|switch(?:\s+to)?|press)\s*/i,
      '',
    )
    .replace(/^(?:在|到)\s*/i, '')
    .replace(/\s*(?:即可|一下|呀|吧)$/i, '')
    .replace(/[.。；;，,]+$/g, '')
    .trim();
}

function extractQuotedTargetPrompt(text) {
  const match = text.match(/[“"']([^“”"']+)[”"']\s*([^，。；;,.]*)/);
  if (!match?.[1]) return undefined;

  const suffix = (match[2] || '').match(
    /^(按钮|下拉框|输入框|输入栏|选项|菜单|面板|标签|页签|色块|图标|开关|复选框|单选框|滑块|区域|列表|工具栏)/,
  )?.[1];
  return normalizeLocatePrompt(`${match[1]}${suffix || ''}`);
}

function extractNaturalLanguageClickPrompt(action) {
  const text = normalizeNaturalLanguageActionText(action);
  if (!text) return undefined;

  if (
    /(下滑|上滑|左滑|右滑|滑动|滚动|下滚|上滚|scroll|drag|拖动|拖拽|finish|完成|等待|wait)/i.test(
      text,
    )
  ) {
    return undefined;
  }

  const hasClickIntent =
    /(点击|点按|单击|双击|右键点击|打开|展开|选中|选择|切换到|切到|进入|按下|按|click|tap|select|expand|switch to|open)/i.test(
      text,
    ) || /^点/.test(text);
  if (!hasClickIntent) return undefined;

  return extractQuotedTargetPrompt(text) || normalizeLocatePrompt(text);
}

function extractNaturalLanguageScroll(action) {
  const text = normalizeNaturalLanguageActionText(action);
  if (!text) return undefined;

  const hasScrollIntent =
    /(下滑|上滑|左滑|右滑|向下滑|向上滑|向左滑|向右滑|往下滑|往上滑|往左滑|往右滑|滑动|滚动|下滚|上滚|scroll)/i.test(
      text,
    );
  if (!hasScrollIntent) return undefined;

  const direction = /(上滑|向上|往上|上滚|\bup\b)/i.test(text)
    ? 'up'
    : /(左滑|向左|往左|\bleft\b)/i.test(text)
      ? 'left'
      : /(右滑|向右|往右|\bright\b)/i.test(text)
        ? 'right'
        : 'down';
  const scrollType = /(?:到|至)(?:底部|最下方|末尾|bottom)/i.test(text)
    ? 'scrollToBottom'
    : /(?:到|至)(?:顶部|最上方|开头|top)/i.test(text)
      ? 'scrollToTop'
      : /(?:到|至)(?:最右|右侧|right)/i.test(text)
        ? 'scrollToRight'
        : /(?:到|至)(?:最左|左侧|left)/i.test(text)
          ? 'scrollToLeft'
          : 'singleAction';

  let areaPrompt;
  const areaMatch =
    text.match(
      /在\s*(.+?)\s*(?:中|里|内|区域)?\s*(?:向?[上下左右]滑|往[上下左右]滑|[上下左右]滑|滑动|滚动|下滚|上滚|scroll)/i,
    ) ||
    text.match(
      /(?:对|于)\s*(.+?)\s*(?:中|里|内|区域)?\s*(?:滑动|滚动|scroll)/i,
    );
  if (areaMatch?.[1]) {
    areaPrompt = normalizeLocatePrompt(areaMatch[1]).replace(
      /(中|里|内|区域)$/g,
      '',
    );
  }

  const globalArea =
    /^(页面|当前页面|屏幕|当前屏幕|界面|窗口|画面|page|screen|window)$/i;
  const param = {
    direction,
    scrollType,
    distance: scrollType === 'singleAction' ? 120 : null,
  };
  if (areaPrompt && !globalArea.test(areaPrompt)) {
    param.locate = { prompt: areaPrompt };
  }
  return param;
}

function executorPointToManoPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return undefined;
  const [x, y] = point.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [
    Math.round((x / MANO_LOCAL_EXECUTOR_WIDTH) * 1000),
    Math.round((y / MANO_LOCAL_EXECUTOR_HEIGHT) * 1000),
  ];
}

function manoPointToStartBox(point) {
  return `<|box_start|>(${point[0]},${point[1]})<|box_end|>`;
}

function escapeSingleQuotedActionValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function manoLocalActionToRawAction(action) {
  const actionType = String(action?.action_type || '').toUpperCase();
  if (actionType === 'DONE') return 'finish()';
  if (actionType === 'STOP' || actionType === 'FAIL') {
    return `stop(reason='${escapeSingleQuotedActionValue(
      action?.input?.reason || actionType.toLowerCase(),
    )}')`;
  }
  if (actionType === 'CALL_USER') return 'call_user()';

  const input = action?.input || {};
  const name = input.action || action?.name || '';
  const point = executorPointToManoPoint(input.coordinate);
  const startBox = point ? manoPointToStartBox(point) : undefined;

  if (name === 'left_click' && startBox) {
    return `click(start_box='${startBox}')`;
  }
  if (name === 'double_click' && startBox) {
    return `doubleclick(start_box='${startBox}')`;
  }
  if (name === 'triple_click' && startBox) {
    return `triple_click(start_box='${startBox}')`;
  }
  if (name === 'right_click' && startBox) {
    return `right_single(start_box='${startBox}')`;
  }
  if (name === 'mouse_move' && startBox) {
    return `hover(start_box='${startBox}')`;
  }
  if (name === 'left_click_drag') {
    const start = executorPointToManoPoint(input.start_coordinate);
    const end = executorPointToManoPoint(input.coordinate);
    if (start && end) {
      return `drag(start_box='${manoPointToStartBox(
        start,
      )}', end_box='${manoPointToStartBox(end)}')`;
    }
  }
  if (name === 'scroll') {
    const direction = input.scroll_direction || 'down';
    const amount = input.scroll_amount || 1;
    return startBox
      ? `scroll(start_box='${startBox}', direction='${direction}', amount='${amount}')`
      : `scroll(direction='${direction}', amount='${amount}')`;
  }
  if (name === 'type') {
    return `type(content='${escapeSingleQuotedActionValue(input.text || '')}')`;
  }
  if (name === 'key') {
    const parts = [...(input.modifiers || []), ...(input.mains || [])].filter(
      Boolean,
    );
    return `hotkey(key='${escapeSingleQuotedActionValue(parts.join('+'))}')`;
  }
  if (action?.name === 'open_app') {
    return `open_app(app_name='${escapeSingleQuotedActionValue(
      input.app_name || '',
    )}')`;
  }
  if (action?.name === 'open_url') {
    return `open_url(url='${escapeSingleQuotedActionValue(input.url || '')}')`;
  }

  return undefined;
}

function buildManoContentFromLocalStep(stepData) {
  const reasoning = stepData.reasoning || '';
  const actionDescription = stepData.action_desc || '';
  const actions = Array.isArray(stepData.actions) ? stepData.actions : [];
  const rawAction = actions.map(manoLocalActionToRawAction).find(Boolean);

  if (!rawAction) {
    return [
      reasoning ? `<think>${reasoning}</think>` : undefined,
      actionDescription
        ? `<action_desp>${actionDescription}</action_desp>`
        : undefined,
      "<action>stop(reason='Mano local service returned no executable action')</action>",
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    reasoning ? `<think>${reasoning}</think>` : undefined,
    actionDescription
      ? `<action_desp>${actionDescription}</action_desp>`
      : undefined,
    `<action>${rawAction}</action>`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildChatCompletionResponseFromContent({ model, content }) {
  return {
    id: `chatcmpl-mano-local-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function buildLocateBodyForMano({
  requestBody,
  targetPrompt,
  latestImagePart,
  options,
}) {
  const imageUrl = imageUrlFromContentPart(latestImagePart);
  const imagePayload = base64PayloadFromDataUrl(imageUrl);
  const locatePrompt = `${MANO_LOCATE_OUTPUT_CONTRACT}\n\nTarget element: ${targetPrompt}`;
  const userContent =
    options.backend === 'vlm-service'
      ? `${locatePrompt}\n\n当前截图为<image>`
      : typeof imageUrl === 'string'
        ? [
            {
              type: 'text',
              text: locatePrompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ]
        : locatePrompt;

  return {
    ...requestBody,
    model: options.backend === 'vlm-service' ? 'qwen3-vl' : options.model,
    temperature: 0,
    top_p: 1,
    max_tokens: 128,
    stream: false,
    ...(imagePayload ? { images: [imagePayload] } : {}),
    messages: [
      {
        role: 'system',
        content: MANO_LOCAL_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
  };
}

async function callPlanningLocateFallback({
  options,
  requestBody,
  targetPrompt,
  latestImagePart,
  headers,
}) {
  if (options.backend === 'mano-local') {
    return undefined;
  }

  const locateBody = await resizeTopLevelImagesForMano(
    await resizeImagesForMano(
      buildLocateBodyForMano({
        requestBody,
        targetPrompt,
        latestImagePart,
        options,
      }),
      options.debug,
    ),
    options.debug,
  );

  if (options.debug) {
    await logRequestSummary(
      'planning fallback locate request summary',
      locateBody,
    );
  }

  const locateResponse = await forwardToMano({
    target: options.target,
    pathname: '/v1/chat/completions',
    body: locateBody,
    headers,
    debug: options.debug,
  });
  const pointResult = JSON.parse(
    convertManoContentToLocateJson(firstChoiceContent(locateResponse)),
  );
  const point = Array.isArray(pointResult.point) ? pointResult.point : [];

  if (point.length >= 2 && point.every((value) => Number.isFinite(value))) {
    return [Math.round(point[0]), Math.round(point[1])];
  }

  if (options.debug) {
    console.warn(
      '[mano-midscene-adapter] planning fallback locate failed:',
      stringifyForLog({
        targetPrompt,
        pointResult,
        rawContent: firstChoiceContent(locateResponse),
      }),
    );
  }

  return undefined;
}

async function callManoLocalPlanning({ options, requestBody, dump }) {
  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const screenshotBase64 = latestImageBase64FromMessages(messages);
  if (!screenshotBase64) {
    throw new Error(
      'Mano local backend requires the latest Midscene screenshot image.',
    );
  }

  const session = await ensureManoLocalSession({ options, requestBody });
  const toolResults = buildManoLocalToolResults({
    requestBody,
    screenshotBase64,
    options,
  });

  if (options.debug) {
    console.log(
      '[mano-midscene-adapter] Mano local session:',
      stringifyForLog({
        target: options.target,
        sessionId: session.sessionId,
        created: session.created,
        task: session.task,
        toolResults: toolResults.map((result) => ({
          tool_use_id: result.tool_use_id,
          status: result.status,
          include_screenshot: result.include_screenshot,
          screenshotChars: result.screenshot_b64?.length,
          screenshotSha256: result.screenshot_b64
            ? hashText(result.screenshot_b64)
            : undefined,
        })),
      }),
    );
  }

  const stepData = await callManoLocalService({
    options,
    method: 'POST',
    pathname: `/v1/local/sessions/${session.sessionId}/step`,
    payload: { tool_results: toolResults },
  });

  if (options.debug) {
    console.log(
      '[mano-midscene-adapter] Mano local step response:',
      stringifyForLog(stepData),
    );
  }

  const content = buildManoContentFromLocalStep(stepData);
  const response = buildChatCompletionResponseFromContent({
    model: requestBody.model || options.model,
    content,
  });
  response._manoLocal = {
    status: stepData.status,
    actions: stepData.actions,
    action_desc: stepData.action_desc,
    sessionId: session.sessionId,
    screenshotDump: dump?.forwardedImage || dump?.originalImage,
  };

  return response;
}

function convertManoActionToMidscene(rawAction, coordinateContext = {}) {
  const action = rawAction.trim();
  const actionName = normalizeActionName(action);
  const isStructuredAction = looksLikeStructuredAction(action);
  const naturalLanguagePointByPrompt =
    coordinateContext.naturalLanguagePointByPrompt || {};

  if (!action) return undefined;

  const typeAction = firstActionByName(action, ['type']);
  if (typeAction && actionName !== 'type') {
    const inputValue = chooseInputValueFromAction(
      typeAction,
      coordinateContext,
    );
    if (
      actionLooksLikeSearchSubmit(action, coordinateContext) &&
      hasPreviousInputValue(coordinateContext.messages, inputValue)
    ) {
      return {
        type: 'KeyboardPress',
        param: {
          keyName: 'enter',
        },
      };
    }

    const pointAction = firstPointerAction(action);
    const point = pointAction ? parseFirstPoint(pointAction) : undefined;
    return {
      type: 'Input',
      param: {
        value: inputValue,
        mode: 'typeOnly',
        ...(point
          ? {
              locate: locateFromPoint(
                point,
                'the target input field',
                coordinateContext,
              ),
            }
          : {}),
      },
    };
  }

  if (
    actionLooksLikeSearchSubmit(action, coordinateContext) &&
    hasPreviousInputValue(
      coordinateContext.messages,
      extractSearchText(coordinateContext.task),
    )
  ) {
    return {
      type: 'KeyboardPress',
      param: {
        keyName: 'enter',
      },
    };
  }

  const naturalLanguageInputValue = extractNaturalLanguageInputValue(
    action,
    coordinateContext,
  );
  if (
    naturalLanguageInputValue &&
    actionLooksLikeSearchSubmit(action, coordinateContext) &&
    hasPreviousInputValue(coordinateContext.messages, naturalLanguageInputValue)
  ) {
    return {
      type: 'KeyboardPress',
      param: {
        keyName: 'enter',
      },
    };
  }

  const embeddedPointerAction = firstPointerAction(action);
  if (embeddedPointerAction && !isPointerActionName(actionName)) {
    return convertManoActionToMidscene(
      embeddedPointerAction,
      coordinateContext,
    );
  }

  if (naturalLanguageInputValue) {
    const pointAction = firstPointerAction(action);
    const point = pointAction ? parseFirstPoint(pointAction) : undefined;
    return {
      type: 'Input',
      param: {
        value: naturalLanguageInputValue,
        mode: 'typeOnly',
        ...(point
          ? {
              locate: locateFromPoint(
                point,
                'the target input field',
                coordinateContext,
              ),
            }
          : {}),
      },
    };
  }

  if (actionName === 'finish' || actionName === 'done') {
    const content =
      parseQuotedValue(action, 'content') ||
      parseQuotedValue(action, 'answer') ||
      'done';
    return { complete: { success: true, message: content } };
  }

  if (actionName === 'stop' || actionName === 'fail') {
    const reason =
      parseQuotedValue(action, 'reason') ||
      parseQuotedValue(action, 'content') ||
      stripFunctionNoise(action) ||
      'stopped';
    return { complete: { success: false, message: reason } };
  }

  if (
    [
      'click',
      'doubleclick',
      'triple_click',
      'right_single',
      'hover',
      'hotkey_click',
    ].includes(actionName)
  ) {
    const point = parseFirstPoint(action);
    if (!point) {
      if (!isStructuredAction) {
        const naturalLanguageClickPrompt =
          extractNaturalLanguageClickPrompt(action);
        if (naturalLanguageClickPrompt) {
          const point =
            naturalLanguagePointByPrompt[naturalLanguageClickPrompt];
          return {
            type: 'Tap',
            param: {
              locate: point
                ? locateFromPoint(
                    point,
                    naturalLanguageClickPrompt,
                    coordinateContext,
                  )
                : {
                    prompt: naturalLanguageClickPrompt,
                  },
            },
          };
        }
      }

      return {
        error: `Mano returned "${action}" without coordinates. Pointer actions must include start_box coordinates normalized to 0-1000.`,
      };
    }

    const prompt = 'the target position';
    const typeByActionName = {
      click: 'Tap',
      doubleclick: 'DoubleClick',
      triple_click: 'TripleClick',
      right_single: 'RightClick',
      hover: 'Hover',
      hotkey_click: 'HotkeyClick',
    };
    const param = {
      locate: locateFromPoint(point, prompt, coordinateContext),
    };

    if (actionName === 'hotkey_click') {
      param.keyName = convertKeyName(
        parseQuotedValue(action, 'key') ||
          parseQuotedValue(action, 'keyName') ||
          parseLooseParams(action).key ||
          'shift',
      );
    }

    return {
      type: typeByActionName[actionName],
      param,
    };
  }

  if (actionName === 'type') {
    return {
      type: 'Input',
      param: {
        value: chooseInputValueFromAction(action, coordinateContext),
        mode: 'typeOnly',
      },
    };
  }

  if (actionName === 'hotkey') {
    const keyName =
      parseQuotedValue(action, 'key') ||
      parseQuotedValue(action, 'keyName') ||
      parseLooseParams(action).key ||
      stripFunctionNoise(action);
    return {
      type: 'KeyboardPress',
      param: {
        keyName: convertKeyName(keyName),
      },
    };
  }

  if (actionName === 'scroll') {
    const direction =
      parseQuotedValue(action, 'direction') ||
      parseLooseParams(action).direction ||
      parseLooseParams(action).dir ||
      (/\bup\b/i.test(action)
        ? 'up'
        : /\bleft\b/i.test(action)
          ? 'left'
          : /\bright\b/i.test(action)
            ? 'right'
            : 'down');
    const amount = parseNumberParam(action, ['amount', 'scroll_amount'], 0);
    const point = parseFirstPoint(action);
    return {
      type: 'Scroll',
      param: {
        direction: direction.toLowerCase(),
        scrollType: 'singleAction',
        distance: amount > 0 ? Math.round(amount * 120) : null,
        ...(point
          ? {
              locate: locateFromPoint(
                point,
                'the scroll position',
                coordinateContext,
              ),
            }
          : {}),
      },
    };
  }

  if (actionName === 'drag') {
    const points = parseDragPoints(action);
    if (!points) return undefined;

    return {
      type: 'DragAndDrop',
      param: {
        from: locateFromPoint(
          points.start,
          'the drag start position',
          coordinateContext,
        ),
        to: locateFromPoint(
          points.end,
          'the drag end position',
          coordinateContext,
        ),
      },
    };
  }

  if (actionName === 'wait' || actionName === 'sleep') {
    const duration = parseNumberParam(
      action,
      ['duration', 'time', 'seconds'],
      1,
    );
    return {
      type: 'Sleep',
      param: {
        timeMs: Math.max(0, Math.round(duration * 1000)),
      },
    };
  }

  if (actionName === 'screenshot') {
    return {
      type: 'Sleep',
      param: {
        timeMs: 300,
      },
    };
  }

  if (actionName === 'open_app') {
    const appName =
      parseQuotedValue(action, 'app_name') ||
      parseQuotedValue(action, 'appName') ||
      parseQuotedValue(action, 'name') ||
      stripFunctionNoise(action);
    return {
      type: 'OpenApp',
      param: {
        appName,
      },
    };
  }

  if (actionName === 'open_url') {
    const url =
      parseQuotedValue(action, 'url') ||
      parseQuotedValue(action, 'href') ||
      stripFunctionNoise(action);
    return {
      type: 'OpenUrl',
      param: {
        url,
      },
    };
  }

  if (actionName === 'call_user') {
    return {
      complete: {
        success: false,
        message: 'Mano requested human help.',
      },
    };
  }

  const naturalLanguageScroll = extractNaturalLanguageScroll(action);
  if (naturalLanguageScroll) {
    return {
      type: 'Scroll',
      param: naturalLanguageScroll,
    };
  }

  const naturalLanguageClickPrompt = extractNaturalLanguageClickPrompt(action);
  if (naturalLanguageClickPrompt) {
    const point = naturalLanguagePointByPrompt[naturalLanguageClickPrompt];
    return {
      type: 'Tap',
      param: {
        locate: point
          ? locateFromPoint(
              point,
              naturalLanguageClickPrompt,
              coordinateContext,
            )
          : {
              prompt: naturalLanguageClickPrompt,
            },
      },
    };
  }

  return undefined;
}

export function convertManoContentToMidsceneXml(
  content,
  coordinateContext = {},
) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return '<error>Mano returned an empty response.</error>';
  }

  if (/<action-type\b/i.test(rawContent) || /<complete\b/i.test(rawContent)) {
    return rawContent.replaceAll('action_param_json', 'action-param-json');
  }

  const thought =
    extractTaggedContent(rawContent, 'thought') ||
    extractTaggedContent(rawContent, 'think');
  const actionDescription = extractTaggedContent(rawContent, 'action_desp');
  const actionLog = extractTaggedContent(rawContent, 'log');
  const manoAction =
    extractTaggedContent(rawContent, 'action') ||
    actionDescription ||
    actionLog ||
    rawContent;
  const converted = convertManoActionToMidscene(manoAction, coordinateContext);

  if (!converted) {
    return [
      thought ? `<thought>${xmlEscape(thought)}</thought>` : undefined,
      `<log>${xmlEscape(manoAction)}</log>`,
      '<error>Could not convert Mano action to Midscene XML.</error>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (converted.error) {
    return [
      thought ? `<thought>${xmlEscape(thought)}</thought>` : undefined,
      `<log>${xmlEscape(manoAction)}</log>`,
      `<error>${xmlEscape(converted.error)}</error>`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (converted.complete) {
    const { success, message } = converted.complete;
    if (
      success &&
      shouldRejectImperativeFinish({
        task: coordinateContext.task,
        thought,
        actionDescription,
        message,
        previousMessages: coordinateContext.messages,
      })
    ) {
      const taskText = coordinateContext.task
        ? ` Task: ${coordinateContext.task}`
        : '';
      return [
        thought ? `<thought>${xmlEscape(thought)}</thought>` : undefined,
        `<log>${xmlEscape(actionDescription || manoAction)}</log>`,
        `<error>${xmlEscape(
          `Mano returned finish() for an action task without visible completion proof.${taskText} Refusing to mark Midscene complete.`,
        )}</error>`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return [
      thought ? `<thought>${xmlEscape(thought)}</thought>` : undefined,
      `<complete success="${success ? 'true' : 'false'}">${xmlEscape(
        message,
      )}</complete>`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    thought ? `<thought>${xmlEscape(thought)}</thought>` : undefined,
    `<log>${xmlEscape(actionDescription || manoAction)}</log>`,
    `<action-type>${converted.type}</action-type>`,
    '<action-param-json>',
    JSON.stringify(converted.param, null, 2),
    '</action-param-json>',
  ]
    .filter(Boolean)
    .join('\n');
}

function convertManoContentToLocateJson(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return JSON.stringify({
      point: [],
      errors: ['Mano returned an empty locate response.'],
    });
  }

  const existingJson = rawContent.match(/\{[\s\S]*\}/)?.[0];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if ('bbox' in parsed || 'point' in parsed || 'errors' in parsed) {
        return JSON.stringify(parsed);
      }
    } catch {}
  }

  const manoAction = extractTaggedContent(rawContent, 'action') || rawContent;
  const point = parseFirstPoint(manoAction);
  if (!point) {
    return JSON.stringify({
      point: [],
      errors: [
        `Mano locate response did not include coordinates: ${manoAction}`,
      ],
    });
  }

  return JSON.stringify({
    point: [Math.round(point[0]), Math.round(point[1])],
    errors: [],
  });
}

function extractNaturalLanguageClickPromptFromContent(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) return undefined;

  if (
    parseFirstPoint(extractTaggedContent(rawContent, 'action') || rawContent)
  ) {
    return undefined;
  }

  const actionDescription = extractTaggedContent(rawContent, 'action_desp');
  const actionLog = extractTaggedContent(rawContent, 'log');
  const manoAction =
    extractTaggedContent(rawContent, 'action') ||
    actionDescription ||
    actionLog ||
    rawContent;

  return extractNaturalLanguageClickPrompt(manoAction);
}

async function buildCoordinateContextForPlanningResponse({
  coordinateContext,
  originalContent,
  requestBody,
  options,
  headers,
}) {
  const targetPrompt =
    extractNaturalLanguageClickPromptFromContent(originalContent);
  if (!targetPrompt) return coordinateContext;

  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const latestImagePart = latestImagePartFromMessages(messages);
  if (!latestImagePart) return coordinateContext;

  const point = await callPlanningLocateFallback({
    options,
    requestBody,
    targetPrompt,
    latestImagePart,
    headers,
  });
  if (!point) return coordinateContext;

  return {
    ...coordinateContext,
    naturalLanguagePointByPrompt: {
      ...(coordinateContext.naturalLanguagePointByPrompt || {}),
      [targetPrompt]: point,
    },
  };
}

async function rewriteChatCompletionResponse(
  data,
  debug,
  responseMode,
  coordinateContext,
  requestBody,
  options,
  headers,
) {
  const rewritten = structuredClone(data);

  for (const choice of rewritten.choices || []) {
    const message = choice?.message;
    if (!message || typeof message.content !== 'string') continue;

    const originalContent = message.content;
    const nextCoordinateContext =
      responseMode === 'planning' && requestBody && options
        ? await buildCoordinateContextForPlanningResponse({
            coordinateContext,
            originalContent,
            requestBody,
            options,
            headers,
          })
        : coordinateContext;
    message.content =
      responseMode === 'locate'
        ? convertManoContentToLocateJson(originalContent)
        : convertManoContentToMidsceneXml(
            originalContent,
            nextCoordinateContext,
          );

    if (debug) {
      console.log('[mano-midscene-adapter] original:', originalContent);
      console.log('[mano-midscene-adapter] rewritten:', message.content);
    }
  }

  return rewritten;
}

async function dumpManoResponsePoint({
  manoResponse,
  dump,
  responseMode,
  debug,
}) {
  if (!debug || !MANO_DUMP_ENABLED || !dump || responseMode !== 'planning') {
    return;
  }

  try {
    const content = firstChoiceContent(manoResponse);
    const point = extractManoPointFromContent(content);
    const originalPixelPoint = normalizedPointToPixel(point, dump.originalSize);
    const forwardedPixelPoint = normalizedPointToPixel(
      point,
      dump.forwardedSize,
    );
    const manoExecutorPoint = normalizedPointToManoExecutor(point);
    const midsceneScreenMapping = normalizeManoPointToScreenPoint(point, {
      originalSize: dump.originalSize,
      midsceneScreenSize: getLocalScreenSize(),
    });
    const estimatedMidsceneLogicalPoint =
      estimateRetinaLogicalPoint(originalPixelPoint);

    const markedOriginal = await saveMarkedPointImage({
      imageUrl: dump.originalImageUrl,
      point,
      outputPath: dump.paths.markedOriginal,
      prompt: point ? `Mano point ${point.join(',')}` : 'Mano point missing',
    });
    const markedForwarded = await saveMarkedPointImage({
      imageUrl: dump.forwardedImageUrl,
      point,
      outputPath: dump.paths.markedForwarded,
      prompt: point ? `Mano point ${point.join(',')}` : 'Mano point missing',
    });

    const payload = {
      manoPointNormalized: point,
      manoExecutorPoint,
      midsceneScreenPoint: midsceneScreenMapping?.point,
      midsceneScreenSize: midsceneScreenMapping?.screenSize,
      midsceneCoordinateScale: midsceneScreenMapping?.scale,
      coordinateMapping: midsceneScreenMapping?.source,
      originalPixelPoint,
      forwardedPixelPoint,
      estimatedMidsceneLogicalPoint,
      originalSize: dump.originalSize,
      forwardedSize: dump.forwardedSize,
      originalImage: dump.originalImage,
      forwardedImage: dump.forwardedImage,
      markedOriginalImage: markedOriginal
        ? dump.paths.markedOriginal
        : undefined,
      markedForwardedImage: markedForwarded
        ? dump.paths.markedForwarded
        : undefined,
      rawContent: content,
    };

    await writeFile(
      dump.paths.coords,
      JSON.stringify(payload, null, 2),
      'utf8',
    );
    console.log(
      '[mano-midscene-adapter] point dump:',
      stringifyForLog({
        coords: dump.paths.coords,
        manoPointNormalized: payload.manoPointNormalized,
        manoExecutorPoint: payload.manoExecutorPoint,
        midsceneScreenPoint: payload.midsceneScreenPoint,
        midsceneScreenSize: payload.midsceneScreenSize,
        midsceneCoordinateScale: payload.midsceneCoordinateScale,
        coordinateMapping: payload.coordinateMapping,
        originalPixelPoint: payload.originalPixelPoint,
        forwardedPixelPoint: payload.forwardedPixelPoint,
        estimatedMidsceneLogicalPoint: payload.estimatedMidsceneLogicalPoint,
        markedOriginalImage: payload.markedOriginalImage,
        markedForwardedImage: payload.markedForwardedImage,
      }),
    );
  } catch (error) {
    console.warn(
      '[mano-midscene-adapter] failed to dump Mano point image:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function buildModelsResponse(model) {
  return {
    object: 'list',
    data: [
      {
        id: model,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'local-mano',
      },
    ],
  };
}

function createServer(options) {
  if (options.backend === 'mano-local' && !options.localState) {
    options.localState = createManoLocalState();
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
      }

      if (req.method === 'GET' && isModelsPath(url.pathname)) {
        sendJson(res, 200, buildModelsResponse(options.model));
        return;
      }

      if (req.method === 'POST' && isChatCompletionsPath(url.pathname)) {
        const body = await readJsonBody(req);
        const requestBody = {
          ...body,
          model:
            options.backend === 'mlx-openai'
              ? options.model
              : body.model || options.model,
        };
        const responseMode = resolveRequestMode(requestBody);
        if (options.debug) {
          console.log('[mano-midscene-adapter] request mode:', responseMode);
          console.log(
            '[mano-midscene-adapter] backend/target:',
            stringifyForLog({
              backend: options.backend,
              target: options.target,
            }),
          );
          await logRequestSummary(
            'original Midscene request summary',
            requestBody,
            { omitSystemText: true, textLimit: 800 },
          );
        }

        if (shouldCompleteAfterPreviousClick(requestBody, responseMode)) {
          if (options.debug) {
            console.log(
              '[mano-midscene-adapter] completed click-only instruction after previous pointer action',
              stringifyForLog({
                task: extractMidsceneUserInstruction(
                  requestBody.messages || [],
                ),
                actionHistory: extractPreviousActionHistory(
                  requestBody.messages || [],
                ),
              }),
            );
          }
          sendJson(
            res,
            200,
            buildCompleteChatCompletionResponse(requestBody.model, 'done'),
          );
          return;
        }

        if (shouldCompleteAfterRepeatedNoop(requestBody, responseMode)) {
          if (options.debug) {
            console.log(
              '[mano-midscene-adapter] completed after repeated no-op actions',
              stringifyForLog({
                task: extractMidsceneUserInstruction(
                  requestBody.messages || [],
                ),
                actionHistory: extractPreviousActionHistory(
                  requestBody.messages || [],
                ),
                repeatedRecentActionCount: repeatedRecentActionCount(
                  requestBody.messages || [],
                ),
              }),
            );
          }
          sendJson(
            res,
            200,
            buildCompleteChatCompletionResponse(
              requestBody.model,
              'completed after repeated identical actions',
            ),
          );
          return;
        }

        const manoRequestBody =
          options.backend === 'mano-local'
            ? requestBody
            : await prepareManoRequestBodyForForwarding(
                requestBody,
                options,
                options.debug,
                responseMode,
              );
        let dump;
        try {
          dump = await dumpManoRequestImages({
            originalBody: requestBody,
            manoBody: manoRequestBody,
            responseMode,
            debug: options.debug,
          });
        } catch (error) {
          console.warn(
            '[mano-midscene-adapter] failed to dump Mano request image:',
            error instanceof Error ? error.message : String(error),
          );
        }
        if (options.debug) {
          await logRequestSummary(
            options.backend === 'mano-local'
              ? 'Mano local input summary'
              : 'forwarded Mano request summary',
            manoRequestBody,
          );
        }
        const manoResponse =
          options.backend === 'mano-local' && responseMode === 'planning'
            ? await callManoLocalPlanning({
                options,
                requestBody,
                dump,
              })
            : await forwardToMano({
                target: options.target,
                pathname: url.pathname,
                body: manoRequestBody,
                headers: req.headers,
                debug: options.debug,
              });
        await dumpManoResponsePoint({
          manoResponse,
          dump,
          responseMode,
          debug: options.debug,
        });
        const coordinateContext = {
          messages: requestBody.messages || [],
          midsceneImageSize: dump?.originalSize,
          originalSize: dump?.originalSize,
          forwardedSize: dump?.forwardedSize,
          task: extractMidsceneUserInstruction(requestBody.messages || []),
          debug: options.debug,
        };
        const rewritten = await rewriteChatCompletionResponse(
          manoResponse,
          options.debug,
          responseMode,
          coordinateContext,
          requestBody,
          options,
          req.headers,
        );
        sendJson(res, 200, rewritten);
        return;
      }

      sendJson(res, 404, {
        error: {
          message: `Not found: ${req.method} ${url.pathname}`,
        },
      });
    } catch (error) {
      console.error('[mano-midscene-adapter]', error);
      sendJson(res, 500, {
        error: {
          message: error.message,
        },
      });
    }
  });
}

function startServer(options) {
  assertLocalModelPathForMlxOpenai(options);
  const server = createServer(options);
  server.listen(options.port, options.host, () => {
    console.log(
      `Mano Midscene adapter listening on http://${options.host}:${options.port}/v1`,
    );
    console.log(`Backend: ${options.backend}`);
    console.log(`Forwarding Mano calls to ${options.target}`);
    console.log(`Default model: ${options.model}`);
    console.log(`Planning prompt mode: ${MANO_PROMPT_MODE}`);
    console.log(
      `Mano screenshot width: ${MANO_SCREENSHOT_WIDTH}; executor scale: ${MANO_LOCAL_EXECUTOR_WIDTH}x${MANO_LOCAL_EXECUTOR_HEIGHT}`,
    );
  });
  return server;
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer(parseArgs(process.argv.slice(2)));
}

export {
  convertManoActionToMidscene,
  convertManoContentToLocateJson,
  createServer,
  parseArgs,
  prepareManoRequestBody,
  resolveRequestMode,
  rewriteChatCompletionResponse,
};
