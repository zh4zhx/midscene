#!/usr/bin/env node

import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18081;
const DEFAULT_TARGET = 'http://127.0.0.1:18080/v1';
const DEFAULT_WIKI_REPO = '/Users/test/Documents/auto-platform';
const DEFAULT_SKILL_RELATIVE_DIR = '.codex/skills/wiki-index-query';
const DEFAULT_WIKI_MCP_TOOL = 'query_wiki_index';
const DEFAULT_TOP_K = 2;
const DEFAULT_QUERY_LIMIT = 4;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CLAUDE_TIMEOUT_MS = 300000;
const DEFAULT_MACDOM_BASE_URL = 'http://localhost:3511';
const DEFAULT_MACDOM_TIMEOUT_MS = 3000;
const DEFAULT_MACDOM_SKILL_RELATIVE_DIR = '.agents/skills/macdom';
const DEFAULT_MAX_KNOWLEDGE_CHARS = 7000;
const DEFAULT_LOG_KNOWLEDGE_CHARS = 1200;
const DEFAULT_QUERY_MODEL_MAX_TOKENS = 192;
const DEFAULT_MACDOM_CANDIDATE_LIMIT = 8;
const DEFAULT_MACDOM_USAGE_BBOX_TOLERANCE = 5;
const DEFAULT_MACDOM_USAGE_POINT_TOLERANCE = 8;
const DEFAULT_WIKI_MCP_SERVER = pathJoin(
  SCRIPT_DIR,
  'wiki-index-mcp-server.mjs',
);

let requestSerial = 0;
let mcpRequestSerial = 0;

function parseArgs(argv) {
  const wikiRepo = stripTrailingSlash(
    process.env.WIKI_MIDSCENE_WIKI_REPO || DEFAULT_WIKI_REPO,
  );
  const skillDir = stripTrailingSlash(
    process.env.WIKI_MIDSCENE_SKILL_DIR ||
      pathJoin(wikiRepo, DEFAULT_SKILL_RELATIVE_DIR),
  );
  const options = {
    host: process.env.WIKI_MIDSCENE_HOST || DEFAULT_HOST,
    port: Number(process.env.WIKI_MIDSCENE_PORT || DEFAULT_PORT),
    target: process.env.WIKI_MIDSCENE_TARGET || DEFAULT_TARGET,
    model: process.env.WIKI_MIDSCENE_MODEL || '',
    knowledgeProvider:
      process.env.WIKI_MIDSCENE_KNOWLEDGE_PROVIDER ||
      (process.env.WIKI_MIDSCENE_USE_CLAUDE === '1' ? 'claude' : 'wiki'),
    claudeCommand:
      process.env.WIKI_MIDSCENE_CLAUDE_COMMAND || resolveDefaultClaudeCommand(),
    claudeShell: process.env.WIKI_MIDSCENE_CLAUDE_SHELL === '1',
    claudeArgs: splitArgString(process.env.WIKI_MIDSCENE_CLAUDE_ARGS),
    claudeMcpConfig: process.env.WIKI_MIDSCENE_CLAUDE_MCP_CONFIG || '',
    claudeModel: process.env.WIKI_MIDSCENE_CLAUDE_MODEL || '',
    claudeOutputFormat:
      process.env.WIKI_MIDSCENE_CLAUDE_OUTPUT_FORMAT || 'stream-json',
    claudeTimeoutMs: Number(
      process.env.WIKI_MIDSCENE_CLAUDE_TIMEOUT_MS || DEFAULT_CLAUDE_TIMEOUT_MS,
    ),
    claudeCwd: process.env.WIKI_MIDSCENE_CLAUDE_CWD || wikiRepo,
    claudeCacheMode:
      process.env.WIKI_MIDSCENE_CLAUDE_CACHE_MODE || 'instruction',
    claudeKnowledgeCache: new Map(),
    claudeOnceKnowledge: undefined,
    claudeSkipPermissions:
      process.env.WIKI_MIDSCENE_CLAUDE_SKIP_PERMISSIONS !== '0',
    macdomLocate:
      process.env.WIKI_MIDSCENE_MACDOM_LOCATE === '1' ||
      process.env.WIKI_MIDSCENE_USE_MACDOM === '1',
    macdomRepo: stripTrailingSlash(
      process.env.WIKI_MIDSCENE_MACDOM_REPO || wikiRepo,
    ),
    macdomMode: process.env.WIKI_MIDSCENE_MACDOM_MODE || 'builtin',
    macdomBaseUrl:
      process.env.WIKI_MIDSCENE_MACDOM_BASE_URL || DEFAULT_MACDOM_BASE_URL,
    macdomScreenSize: parseSizeValue(
      process.env.WIKI_MIDSCENE_MACDOM_SCREEN_SIZE,
      'WIKI_MIDSCENE_MACDOM_SCREEN_SIZE',
    ),
    macdomTimeoutMs: Number(
      process.env.WIKI_MIDSCENE_MACDOM_TIMEOUT_MS || DEFAULT_MACDOM_TIMEOUT_MS,
    ),
    macdomDebug: process.env.WIKI_MIDSCENE_MACDOM_DEBUG === '1',
    macdomCandidateModel:
      process.env.WIKI_MIDSCENE_MACDOM_CANDIDATE_MODEL || '',
    macdomCandidateModelEnabled:
      process.env.WIKI_MIDSCENE_MACDOM_CANDIDATE_MODEL_ENABLED !== '0',
    macdomCandidateLimit: Number(
      process.env.WIKI_MIDSCENE_MACDOM_CANDIDATE_LIMIT ||
        DEFAULT_MACDOM_CANDIDATE_LIMIT,
    ),
    macdomCandidateCache: new Map(),
    latestPlanningContext: undefined,
    wikiRepo,
    skillDir,
    queryScript:
      process.env.WIKI_MIDSCENE_QUERY_SCRIPT ||
      pathJoin(skillDir, 'query_wiki_index.py'),
    queryCwd: process.env.WIKI_MIDSCENE_QUERY_CWD || wikiRepo,
    useWikiMcp:
      process.env.WIKI_MIDSCENE_USE_MCP === '1' ||
      process.env.WIKI_MIDSCENE_WIKI_MCP === '1' ||
      Boolean(process.env.WIKI_MIDSCENE_MCP_URL),
    wikiMcpType: process.env.WIKI_MIDSCENE_MCP_TYPE || '',
    wikiMcpUrl: process.env.WIKI_MIDSCENE_MCP_URL || '',
    wikiMcpHeaders: parseHeaderList(process.env.WIKI_MIDSCENE_MCP_HEADERS),
    wikiMcpConfig: process.env.WIKI_MIDSCENE_MCP_CONFIG || '',
    wikiMcpServerName: process.env.WIKI_MIDSCENE_MCP_SERVER || '',
    wikiMcpRepoId: process.env.WIKI_MIDSCENE_MCP_REPO_ID || '',
    wikiMcpCommand: process.env.WIKI_MIDSCENE_MCP_COMMAND || process.execPath,
    wikiMcpArgs: splitArgString(process.env.WIKI_MIDSCENE_MCP_ARGS),
    wikiMcpCwd: process.env.WIKI_MIDSCENE_MCP_CWD || process.cwd(),
    wikiMcpTool: process.env.WIKI_MIDSCENE_MCP_TOOL || '',
    wikiMcpResolvedTool: undefined,
    wikiMcpAvailableTools: undefined,
    topK: Number(process.env.WIKI_MIDSCENE_TOP_K || DEFAULT_TOP_K),
    queryLimit: Number(
      process.env.WIKI_MIDSCENE_QUERY_LIMIT || DEFAULT_QUERY_LIMIT,
    ),
    timeoutMs: Number(
      process.env.WIKI_MIDSCENE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    ),
    maxKnowledgeChars: Number(
      process.env.WIKI_MIDSCENE_MAX_KNOWLEDGE_CHARS ||
        DEFAULT_MAX_KNOWLEDGE_CHARS,
    ),
    queryTermModel:
      process.env.WIKI_MIDSCENE_QUERY_TERM_MODEL ||
      process.env.WIKI_MIDSCENE_MODEL ||
      '',
    queryTermModelMaxTokens: Number(
      process.env.WIKI_MIDSCENE_QUERY_MODEL_MAX_TOKENS ||
        DEFAULT_QUERY_MODEL_MAX_TOKENS,
    ),
    scopes: splitScopeEnv(process.env.WIKI_MIDSCENE_SCOPE),
    enabled: process.env.WIKI_MIDSCENE_ENABLED !== '0',
    logRequests: process.env.WIKI_MIDSCENE_LOG_REQUESTS !== '0',
    logKnowledge: process.env.WIKI_MIDSCENE_LOG_KNOWLEDGE === '1',
    logKnowledgeChars: Number(
      process.env.WIKI_MIDSCENE_LOG_KNOWLEDGE_CHARS ||
        DEFAULT_LOG_KNOWLEDGE_CHARS,
    ),
    debug: process.env.WIKI_MIDSCENE_DEBUG === '1',
    wikiCache: new Map(),
    wikiMcpClient: undefined,
  };
  if (process.env.WIKI_MIDSCENE_MCP_AUTHORIZATION) {
    options.wikiMcpHeaders.authorization =
      process.env.WIKI_MIDSCENE_MCP_AUTHORIZATION;
  }

  const valueRequiredOptions = new Set([
    'host',
    'port',
    'target',
    'model',
    'knowledge-provider',
    'claude-command',
    'claude-args',
    'claude-arg',
    'claude-mcp-config',
    'claude-model',
    'claude-output-format',
    'claude-timeout-ms',
    'claude-cwd',
    'claude-cache-mode',
    'macdom-mode',
    'macdom-repo',
    'macdom-base-url',
    'macdom-screen-size',
    'macdom-timeout-ms',
    'macdom-candidate-model',
    'macdom-candidate-limit',
    'wiki-repo',
    'skill-dir',
    'query-script',
    'query-cwd',
    'wiki-mcp-type',
    'wiki-mcp-url',
    'wiki-mcp-header',
    'wiki-mcp-config',
    'wiki-mcp-server',
    'wiki-mcp-repo-id',
    'wiki-mcp-command',
    'wiki-mcp-args',
    'wiki-mcp-arg',
    'wiki-mcp-cwd',
    'wiki-mcp-tool',
    'top-k',
    'query-limit',
    'timeout-ms',
    'max-knowledge-chars',
    'log-knowledge-chars',
    'query-term-model',
    'query-model-max-tokens',
    'scope',
  ]);

  let claudeCwdExplicit = Boolean(process.env.WIKI_MIDSCENE_CLAUDE_CWD);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [key, inlineValue] = arg.slice(2).split('=');
    let value = inlineValue;
    if (value === undefined && valueRequiredOptions.has(key)) {
      value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;
    }
    if (value === undefined) value = 'true';

    if (key === 'host') options.host = value;
    if (key === 'port') options.port = Number(value);
    if (key === 'target') options.target = value;
    if (key === 'model') options.model = value;
    if (key === 'knowledge-provider') options.knowledgeProvider = value;
    if (key === 'claude-query') options.knowledgeProvider = 'claude';
    if (key === 'claude-command') options.claudeCommand = value;
    if (key === 'claude-shell') options.claudeShell = value !== 'false';
    if (key === 'claude-args') options.claudeArgs = splitArgString(value);
    if (key === 'claude-arg') options.claudeArgs.push(value);
    if (key === 'claude-mcp-config') options.claudeMcpConfig = value;
    if (key === 'claude-model') options.claudeModel = value;
    if (key === 'claude-output-format') options.claudeOutputFormat = value;
    if (key === 'claude-timeout-ms') options.claudeTimeoutMs = Number(value);
    if (key === 'claude-cwd') {
      options.claudeCwd = value;
      claudeCwdExplicit = true;
    }
    if (key === 'claude-cache-mode') options.claudeCacheMode = value;
    if (key === 'claude-skip-permissions') {
      options.claudeSkipPermissions = value !== 'false';
    }
    if (key === 'macdom-locate') options.macdomLocate = value !== 'false';
    if (key === 'macdom-mode') options.macdomMode = value;
    if (key === 'macdom-repo') {
      options.macdomRepo = stripTrailingSlash(value);
    }
    if (key === 'macdom-base-url') options.macdomBaseUrl = value;
    if (key === 'macdom-screen-size') {
      options.macdomScreenSize = parseSizeValue(value, '--macdom-screen-size');
    }
    if (key === 'macdom-timeout-ms') options.macdomTimeoutMs = Number(value);
    if (key === 'macdom-debug') options.macdomDebug = value !== 'false';
    if (key === 'macdom-candidate-model') {
      options.macdomCandidateModel = value;
      options.macdomCandidateModelEnabled = !isDisabledValue(value);
    }
    if (key === 'no-macdom-candidate-model') {
      options.macdomCandidateModelEnabled = false;
    }
    if (key === 'macdom-candidate-limit') {
      options.macdomCandidateLimit = Number(value);
    }
    if (key === 'wiki-repo') {
      options.wikiRepo = stripTrailingSlash(value);
      if (!process.env.WIKI_MIDSCENE_MACDOM_REPO) {
        options.macdomRepo = options.wikiRepo;
      }
      if (!claudeCwdExplicit) {
        options.claudeCwd = options.wikiRepo;
      }
      if (!process.env.WIKI_MIDSCENE_QUERY_CWD) {
        options.queryCwd = options.wikiRepo;
      }
      if (
        !process.env.WIKI_MIDSCENE_SKILL_DIR &&
        !process.env.WIKI_MIDSCENE_QUERY_SCRIPT
      ) {
        options.skillDir = pathJoin(
          options.wikiRepo,
          DEFAULT_SKILL_RELATIVE_DIR,
        );
        options.queryScript = pathJoin(options.skillDir, 'query_wiki_index.py');
      }
    }
    if (key === 'skill-dir') {
      options.skillDir = stripTrailingSlash(value);
      if (!process.env.WIKI_MIDSCENE_QUERY_SCRIPT) {
        options.queryScript = pathJoin(options.skillDir, 'query_wiki_index.py');
      }
    }
    if (key === 'query-script') options.queryScript = value;
    if (key === 'query-cwd') options.queryCwd = value;
    if (key === 'wiki-mcp') options.useWikiMcp = value !== 'false';
    if (key === 'wiki-mcp-type') options.wikiMcpType = value;
    if (key === 'wiki-mcp-url') {
      options.wikiMcpUrl = value;
      options.useWikiMcp = true;
    }
    if (key === 'wiki-mcp-header') {
      Object.assign(options.wikiMcpHeaders, parseHeaderList(value));
    }
    if (key === 'wiki-mcp-config') {
      options.wikiMcpConfig = value;
      options.useWikiMcp = true;
    }
    if (key === 'wiki-mcp-server') options.wikiMcpServerName = value;
    if (key === 'wiki-mcp-repo-id') options.wikiMcpRepoId = value;
    if (key === 'wiki-mcp-command') options.wikiMcpCommand = value;
    if (key === 'wiki-mcp-args') options.wikiMcpArgs = splitArgString(value);
    if (key === 'wiki-mcp-arg') options.wikiMcpArgs.push(value);
    if (key === 'wiki-mcp-cwd') options.wikiMcpCwd = value;
    if (key === 'wiki-mcp-tool') options.wikiMcpTool = value;
    if (key === 'top-k') options.topK = Number(value);
    if (key === 'query-limit') options.queryLimit = Number(value);
    if (key === 'timeout-ms') options.timeoutMs = Number(value);
    if (key === 'max-knowledge-chars') {
      options.maxKnowledgeChars = Number(value);
    }
    if (key === 'query-term-model') options.queryTermModel = value;
    if (key === 'query-model-max-tokens') {
      options.queryTermModelMaxTokens = Number(value);
    }
    if (key === 'scope') options.scopes.push(value);
    if (key === 'debug') options.debug = value !== 'false';
    if (key === 'quiet') options.logRequests = false;
    if (key === 'log-requests') options.logRequests = value !== 'false';
    if (key === 'log-knowledge') options.logKnowledge = value !== 'false';
    if (key === 'log-knowledge-chars') {
      options.logKnowledgeChars = Number(value);
    }
    if (key === 'disabled') options.enabled = false;
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  applyMcpServerConfig(options);

  const normalizedOptions = {
    ...options,
    target: stripTrailingSlash(options.target),
    wikiMcpUrl: stripTrailingSlash(options.wikiMcpUrl),
    wikiMcpType: options.wikiMcpType || (options.wikiMcpUrl ? 'http' : 'stdio'),
    wikiMcpTool:
      options.wikiMcpTool || (options.wikiMcpUrl ? '' : DEFAULT_WIKI_MCP_TOOL),
    topK: normalizePositiveInteger(options.topK, DEFAULT_TOP_K),
    queryLimit: normalizePositiveInteger(
      options.queryLimit,
      DEFAULT_QUERY_LIMIT,
    ),
    timeoutMs: normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    claudeMcpConfig: options.claudeMcpConfig,
    claudeTimeoutMs: normalizePositiveInteger(
      options.claudeTimeoutMs,
      DEFAULT_CLAUDE_TIMEOUT_MS,
    ),
    claudeCwd: options.claudeCwd,
    macdomMode: normalizeMacdomMode(options.macdomMode),
    macdomRepo: stripTrailingSlash(options.macdomRepo),
    macdomBaseUrl: options.macdomBaseUrl,
    macdomScreenSize: options.macdomScreenSize,
    macdomTimeoutMs: normalizePositiveInteger(
      options.macdomTimeoutMs,
      DEFAULT_MACDOM_TIMEOUT_MS,
    ),
    macdomCandidateLimit: normalizePositiveInteger(
      options.macdomCandidateLimit,
      DEFAULT_MACDOM_CANDIDATE_LIMIT,
    ),
    maxKnowledgeChars: normalizePositiveInteger(
      options.maxKnowledgeChars,
      DEFAULT_MAX_KNOWLEDGE_CHARS,
    ),
    logKnowledgeChars: normalizePositiveInteger(
      options.logKnowledgeChars,
      DEFAULT_LOG_KNOWLEDGE_CHARS,
    ),
    queryTermModelMaxTokens: normalizePositiveInteger(
      options.queryTermModelMaxTokens,
      DEFAULT_QUERY_MODEL_MAX_TOKENS,
    ),
  };
  return {
    ...normalizedOptions,
    wikiMcpArgs: resolveWikiMcpArgs(normalizedOptions),
  };
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeMacdomMode(value) {
  const normalized = String(value || 'builtin')
    .trim()
    .toLowerCase();
  if (['builtin', 'http', 'chui'].includes(normalized)) return 'builtin';
  if (['python', 'legacy', 'skill'].includes(normalized)) return 'python';
  throw new Error(
    `Invalid --macdom-mode: ${value}. Expected builtin or python`,
  );
}

function parseSizeValue(value, label = 'size') {
  const text = String(value || '').trim();
  if (!text) return undefined;

  const match = text.match(/^(\d+(?:\.\d+)?)\s*[x,]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) {
    throw new Error(`Invalid ${label}: expected WIDTHxHEIGHT, got ${text}`);
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid ${label}: width and height must be positive`);
  }

  return { width, height };
}

function isDisabledValue(value) {
  return ['0', 'false', 'off', 'disabled', 'none'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );
}

function resolveDefaultClaudeCommand() {
  const candidates = [
    pathJoin(homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((candidate) => existsSync(candidate)) || 'claude';
}

function splitScopeEnv(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeHeaderName(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function parseHeaderList(value) {
  if (!value) return {};

  const text = String(value).trim();
  if (!text) return {};

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed)
            .map(([key, headerValue]) => [
              normalizeHeaderName(key),
              String(headerValue),
            ])
            .filter(([key]) => key),
        );
      }
    } catch {
      // Fall through to delimited header parsing.
    }
  }

  const headers = {};
  for (const item of text.split('|')) {
    const separator = item.includes(':') ? ':' : '=';
    const index = item.indexOf(separator);
    if (index <= 0) continue;
    const key = normalizeHeaderName(item.slice(0, index));
    const headerValue = item.slice(index + 1).trim();
    if (key) headers[key] = headerValue;
  }
  return headers;
}

function parseJsonConfigFile(filePath) {
  if (!filePath) return {};
  if (!existsSync(filePath)) {
    throw new Error(`MCP config file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function selectMcpServerConfig(config, serverName) {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object') return undefined;
  if (serverName) return servers[serverName];

  if (servers.kbgraph) return servers.kbgraph;

  const firstServerName = Object.keys(servers)[0];
  return firstServerName ? servers[firstServerName] : undefined;
}

function applyMcpServerConfig(options) {
  if (!options.wikiMcpConfig) return;

  const config = parseJsonConfigFile(options.wikiMcpConfig);
  const serverConfig = selectMcpServerConfig(config, options.wikiMcpServerName);
  if (!serverConfig || typeof serverConfig !== 'object') {
    throw new Error(
      `No MCP server config found${options.wikiMcpServerName ? `: ${options.wikiMcpServerName}` : ''}`,
    );
  }

  if (serverConfig.type) options.wikiMcpType = String(serverConfig.type);
  if (serverConfig.url) {
    options.wikiMcpUrl = String(serverConfig.url);
    options.useWikiMcp = true;
  }
  if (serverConfig.command) {
    options.wikiMcpCommand = String(serverConfig.command);
    options.useWikiMcp = true;
  }
  if (Array.isArray(serverConfig.args)) {
    options.wikiMcpArgs = serverConfig.args.map(String);
  }
  if (serverConfig.cwd) options.wikiMcpCwd = String(serverConfig.cwd);
  if (serverConfig.headers && typeof serverConfig.headers === 'object') {
    Object.assign(
      options.wikiMcpHeaders,
      parseHeaderList(JSON.stringify(serverConfig.headers)),
    );
  }
  if (serverConfig.tool) options.wikiMcpTool = String(serverConfig.tool);
  if (serverConfig.repo_id)
    options.wikiMcpRepoId = String(serverConfig.repo_id);
  if (serverConfig.repoId) options.wikiMcpRepoId = String(serverConfig.repoId);
}

function splitArgString(value) {
  if (!value) return [];

  const trimmed = String(value).trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Fall through to shell-like splitting.
    }
  }

  const args = [];
  const pattern =
    /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match = pattern.exec(trimmed);
  while (match) {
    args.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, '$1'));
    match = pattern.exec(trimmed);
  }
  return args;
}

function resolveWikiMcpArgs(options) {
  if (options.wikiMcpArgs.length) return options.wikiMcpArgs;

  return [
    DEFAULT_WIKI_MCP_SERVER,
    '--wiki-repo',
    options.wikiRepo,
    '--query-script',
    options.queryScript,
    '--query-cwd',
    options.queryCwd,
    '--top-k',
    String(options.topK),
    '--timeout-ms',
    String(options.timeoutMs),
  ];
}

function logRequest(options, message, payload) {
  if (!options.logRequests && !options.debug) return;

  const suffix = payload ? ` ${JSON.stringify(payload)}` : '';
  console.log(`[wiki-midscene-adapter] ${message}${suffix}`);
}

function pathJoin(...parts) {
  return parts
    .filter(
      (part) => part !== undefined && part !== null && String(part) !== '',
    )
    .map((part, index) =>
      index === 0
        ? String(part).replace(/\/+$/g, '')
        : String(part).replace(/^\/+|\/+$/g, ''),
    )
    .join('/');
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function buildTargetUrl(targetBase, pathname, search = '') {
  const normalized = normalizePath(pathname);
  const targetPath = normalized.startsWith('/v1/')
    ? normalized.slice('/v1'.length)
    : normalized;
  return `${targetBase}${targetPath}${search || ''}`;
}

function isChatCompletionsPath(pathname) {
  const normalized = normalizePath(pathname);
  return (
    normalized === '/v1/chat/completions' || normalized === '/chat/completions'
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

function sendProxyResponse(res, response, text) {
  res.writeHead(response.status, {
    'content-type':
      response.headers.get('content-type') || 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(text);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const rawBody = await readRawBody(req);
  const text = rawBody.toString('utf8');
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON request body: ${error.message}`);
  }
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

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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
    /"bbox"\s*:|`bbox`|"point"\s*:|`point`|Output Format:[\s\S]*"bbox"|Output Format:[\s\S]*"point"|Find:\s*|Find section containing:\s*|Identify elements in screenshots|Provide the coordinates of the element/i.test(
      joinedText,
    ) &&
    !requestLooksLikeMidscenePlanning(body)
  );
}

function extractLocatePromptFromMessages(messages) {
  const texts = messages.map((message) => contentToText(message.content));
  for (const text of texts) {
    for (const pattern of [
      /(?:^|\n)\s*Find:\s*([^\n]+)/i,
      /(?:^|\n)\s*Find section containing:\s*([^\n]+)/i,
    ]) {
      const match = text.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return '';
}

function extractImageSizeFromDataUrl(dataUrl) {
  const text = String(dataUrl || '');
  const base64 = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

function extractFirstImageSize(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const url = part?.image_url?.url;
      if (typeof url !== 'string') continue;
      const size = extractImageSizeFromDataUrl(url);
      if (size?.width && size?.height) return size;
    }
  }
  return undefined;
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

  return fallback?.trim() || '';
}

function normalizeModelQueryTerm(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushModelQueryTerm(terms, value) {
  const normalized = normalizeModelQueryTerm(value);
  if (!normalized || normalized.length < 2) return;

  terms.push(normalized);
}

function parseQueryTermsFromModelContent(content, limit) {
  const raw = String(content || '').trim();
  if (!raw) return [];

  const jsonText = raw.match(/\[[\s\S]*?\]/)?.[0] || raw;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    const terms = [];
    for (const item of parsed) {
      if (typeof item === 'string') {
        pushModelQueryTerm(terms, item);
      } else if (item && typeof item === 'object') {
        pushModelQueryTerm(
          terms,
          item.query || item.term || item.keyword || '',
        );
      }
    }
    return [...new Set(terms)].slice(0, limit);
  } catch {
    return [];
  }
}

async function generateWikiQueryTermsWithModel(
  instruction,
  options,
  requestModel,
) {
  const model =
    options.queryTermModel || requestModel || 'qwen3-vl:8b-instruct-q4_K_M';
  const prompt = [
    '你是本地产品 wiki 检索词生成器。',
    '请把用户的 UI 自动化指令改写成适合知识库检索的短 query 列表。',
    '要求：',
    '- 只输出 JSON 字符串数组，不要 Markdown，不要解释。',
    '- 每个 query 应该是页面、模块、控件、功能分组、具体选项或参数名。',
    '- 去掉动作意图和泛化控件类型词，只保留真实产品名称。',
    '- 如果用户指令包含多个可单独检索的目标，同时给出组合 query 和独立 query。',
    '- 不要使用脚本内置业务词扩展；只根据用户原始指令改写。',
    `- 最多 ${options.queryLimit} 个，按最可能命中的顺序排列。`,
    '',
    `用户指令：${instruction}`,
  ].join('\n');

  const response = await fetch(
    buildTargetUrl(options.target, '/v1/chat/completions'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer local',
      },
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0,
        top_p: 1,
        stream: false,
        max_tokens: options.queryTermModelMaxTokens,
      }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `query term model failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `query term model returned non-JSON: ${text.slice(0, 300)}`,
    );
  }

  const content = data?.choices?.[0]?.message?.content || '';
  return parseQueryTermsFromModelContent(content, options.queryLimit);
}

async function resolveWikiQueryTerms(instruction, options, requestModel) {
  try {
    const modelTerms = await generateWikiQueryTermsWithModel(
      instruction,
      options,
      requestModel,
    );
    if (modelTerms.length) {
      logRequest(options, 'wiki query terms from model', {
        terms: modelTerms,
      });
      return modelTerms;
    }
    logRequest(options, 'wiki query model returned no usable terms');
  } catch (error) {
    logRequest(options, 'wiki query model failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return [];
}

function compactLocatorToText(locator) {
  if (!locator || typeof locator !== 'object') return '';
  return Object.entries(locator)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function flowToText(flow) {
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];
  return steps
    .slice(0, 10)
    .map((step) => {
      const action = step.action ? `${step.action} ` : '';
      const target = step.target || step.target_name || step.text || '';
      return `${action}${target}`.trim();
    })
    .filter(Boolean)
    .join(' -> ');
}

function summarizeWikiResult(result) {
  const genericSummary = summarizeGenericKnowledgeResult(result);
  if (genericSummary) return genericSummary;

  if (
    !result ||
    !Array.isArray(result.matches) ||
    result.matches.length === 0
  ) {
    return '';
  }

  const lines = [`### Query: ${result.query}`];
  for (const match of result.matches.slice(0, 2)) {
    const entity = match.entity || {};
    const complete = match.complete_view || {};
    const evidence = match.evidence_view || {};
    const hierarchy = complete.hierarchy || {};
    const labels = Array.isArray(hierarchy.full_path_labels)
      ? hierarchy.full_path_labels.join(' -> ')
      : entity.hierarchy_text || '';

    lines.push(
      `- Hit: ${entity.display_name || entity.canonical_name || '(unknown)'} (${entity.entity_type || 'unknown'}), evidence=${entity.evidence_level || evidence.entity_status?.evidence_level || 'unknown'}`,
    );
    if (labels) lines.push(`  Path: ${labels}`);

    const locators = [
      ...(complete.entity_locators || []).map((item) => item.locator),
      ...(complete.macdom_controls || []).map((item) => ({
        target_name: item.target_name,
        ...(item.locator || {}),
      })),
      ...(evidence.verified_locators || []),
    ]
      .map(compactLocatorToText)
      .filter(Boolean);
    const uniqueLocators = [...new Set(locators)];
    if (uniqueLocators.length) {
      lines.push(`  Locators: ${uniqueLocators.slice(0, 6).join(' | ')}`);
    }

    const route = [
      ...(evidence.verified_route_chains || []),
      ...(complete.route_chains || []),
    ].find((item) => Array.isArray(item?.steps) && item.steps.length);
    if (route) lines.push(`  Route: ${flowToText(route)}`);

    const flow = [
      ...(evidence.verified_process_flows || []),
      ...(evidence.supporting_process_flows || []),
      ...(complete.process_flows || []),
    ].find((item) => Array.isArray(item?.steps) && item.steps.length);
    if (flow) lines.push(`  Flow: ${flowToText(flow)}`);

    const notes = Array.isArray(evidence.notes) ? evidence.notes : [];
    if (notes.length) lines.push(`  Notes: ${notes.slice(0, 2).join('；')}`);
  }

  return lines.join('\n');
}

function summarizeGenericKnowledgeResult(result) {
  if (!result) return '';

  if (typeof result === 'string') {
    return result.trim() ? `### Knowledge\n${result.trim()}` : '';
  }

  if (typeof result !== 'object') return '';
  if (isEmptyKnowledgeResult(result)) return '';

  if (typeof result.knowledge_text === 'string') {
    const title = result.query ? `### Query: ${result.query}` : '### Knowledge';
    return result.knowledge_text.trim()
      ? `${title}\n${result.knowledge_text.trim()}`
      : '';
  }

  if (Array.isArray(result.matches)) return '';

  const candidates = [
    result.results,
    result.items,
    result.data,
    result.documents,
    result.nodes,
  ].find((value) => Array.isArray(value));

  if (Array.isArray(candidates)) {
    if (!candidates.length) return '';

    const lines = [
      result.query ? `### Query: ${result.query}` : '### Knowledge',
    ];
    for (const item of candidates.slice(0, 3)) {
      const title =
        item?.title ||
        item?.name ||
        item?.display_name ||
        item?.canonical_name ||
        item?.id ||
        'Result';
      const text =
        item?.text ||
        item?.content ||
        item?.summary ||
        item?.description ||
        item?.snippet ||
        '';
      lines.push(`- Hit: ${title}`);
      if (text) lines.push(`  ${String(text).slice(0, 1200)}`);
    }
    return lines.join('\n');
  }

  const text = JSON.stringify(result);
  return text === '{}' ? '' : `### Knowledge\n${text.slice(0, 2500)}`;
}

function isEmptyKnowledgeResult(result) {
  if (!result || typeof result !== 'object') return true;

  const numericCount = [
    result.match_count,
    result.matchCount,
    result.count,
    result.total,
    result.total_count,
    result.totalCount,
  ].find((value) => typeof value === 'number');
  if (numericCount === 0) return true;

  const arrayFields = [
    result.matches,
    result.results,
    result.items,
    result.data,
    result.documents,
    result.nodes,
  ].filter((value) => Array.isArray(value));
  if (arrayFields.length && arrayFields.every((value) => value.length === 0)) {
    return true;
  }

  return Object.keys(result).length === 0;
}

function getKnowledgeMatchCount(result) {
  if (!result || typeof result !== 'object') return 0;

  for (const value of [
    result.match_count,
    result.matchCount,
    result.count,
    result.total,
    result.total_count,
    result.totalCount,
  ]) {
    if (typeof value === 'number') return value;
  }

  for (const value of [
    result.matches,
    result.results,
    result.items,
    result.data,
    result.documents,
    result.nodes,
  ]) {
    if (Array.isArray(value)) return value.length;
  }

  if (
    typeof result.knowledge_text === 'string' &&
    result.knowledge_text.trim()
  ) {
    return 1;
  }

  return 0;
}

function truncateKnowledge(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... truncated ${text.length - maxChars} chars`;
}

function knowledgePreview(text, options) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (options.logKnowledge) return normalized;
  return truncateKnowledge(normalized, options.logKnowledgeChars);
}

function logKnowledge(options, message, knowledge) {
  const preview = knowledgePreview(knowledge, options);
  if (!preview) return;
  logRequest(options, message, {
    chars: String(knowledge || '').length,
    preview,
  });
}

function normalizeCandidateValue(value, key = '') {
  let text = String(value || '')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(/[。；;，,\s]+$/g, '')
    .trim();

  if (['object_name', 'class_name'].includes(key)) {
    const identifier = text.match(/[A-Za-z_][A-Za-z0-9_.:-]*/)?.[0];
    if (identifier) text = identifier;
  }

  return text;
}

function normalizeCandidate(candidate) {
  return Object.fromEntries(
    Object.entries(candidate || {})
      .map(([key, value]) => [key, normalizeCandidateValue(value, key)])
      .filter(([, value]) => value),
  );
}

function candidateValueVariants(value) {
  const text = normalizeCandidateValue(value);
  if (!text) return [];

  const variants = [];
  const parts = text
    .split(/[\/>｜|:：\-–—_]+/g)
    .map((item) => normalizeCandidateValue(item))
    .filter((item) => item.length >= 2);
  if (parts.length > 1) variants.push(parts.at(-1));

  return [...new Set(variants)].filter((item) => item && item !== text);
}

function pushUniqueCandidate(candidates, candidate) {
  const normalized = normalizeCandidate(candidate);
  const key = JSON.stringify(normalized);
  if (!key || key === '{}') return;
  if (candidates.some((item) => JSON.stringify(item) === key)) return;
  candidates.push(normalized);
}

function pushExpandedCandidate(candidates, candidate) {
  const normalized = normalizeCandidate(candidate);
  if (!Object.keys(normalized).length) return;

  pushUniqueCandidate(candidates, normalized);

  const fieldPriority = [
    'object_name',
    'tool_tip',
    'special',
    'text',
    'class_name',
    'xpath',
  ];
  for (const field of fieldPriority) {
    const value = normalized[field];
    if (!value) continue;
    pushUniqueCandidate(candidates, { [field]: value });
    if (['text', 'tool_tip', 'special'].includes(field)) {
      for (const variant of candidateValueVariants(value)) {
        pushUniqueCandidate(candidates, { [field]: variant });
      }
    }
  }
}

function stripPromptNoise(value) {
  return String(value || '')
    .replace(/^Find:\s*/i, '')
    .replace(/\b(the|a|an)\b/gi, ' ')
    .replace(/\b(area|list|button|card|option|element|target)\b/gi, ' ')
    .replace(
      /(点击|打开|选择|进入|找到|查找|调整|拖动|关闭|切换|勾选|取消)/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuotedTerms(text) {
  const terms = [];
  const pattern = /["'“‘「『]([^"'”’」』]{2,60})["'”’」』]/g;
  let match = pattern.exec(text);
  while (match) {
    terms.push(match[1]);
    match = pattern.exec(text);
  }
  return terms;
}

function extractLastPathSegment(text) {
  const normalized = String(text || '').trim();
  if (!normalized.includes('/')) return '';
  return normalized
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
}

function extractMacdomCandidatesFromKnowledge(knowledge) {
  const text = String(knowledge || '');
  const exactCandidates = [];
  const structuralCandidates = [];

  for (const match of text.matchAll(
    /\bobjectName\s*(?:[=:：]|为)\s*([^\s,，;；)]+)/g,
  )) {
    pushUniqueCandidate(structuralCandidates, { object_name: match[1] });
  }
  for (const match of text.matchAll(
    /\bclassName\s*(?:[=:：]|为)\s*([^\s,，;；)]+)/g,
  )) {
    pushUniqueCandidate(structuralCandidates, { class_name: match[1] });
  }
  for (const match of text.matchAll(
    /\bcontrolType\s*(?:[=:：]|为)\s*([^\s,，;；)]+)/g,
  )) {
    pushUniqueCandidate(structuralCandidates, { class_name: match[1] });
  }
  for (const match of text.matchAll(
    /\btoolTip\s*(?:[=:：]|为)\s*["“]([^"”\n]+)["”]/g,
  )) {
    pushUniqueCandidate(structuralCandidates, { tool_tip: match[1] });
  }
  for (const match of text.matchAll(
    /\btoolTip\s*(?:[=:：]|为)\s*([^\n;；)]+)/g,
  )) {
    pushUniqueCandidate(structuralCandidates, { tool_tip: match[1] });
  }
  for (const match of text.matchAll(/控制类型\s*[=:：]\s*([^\n,，;；)]+)/g)) {
    pushUniqueCandidate(structuralCandidates, { special: match[1] });
  }
  for (const match of text.matchAll(
    /(?:主定位文本|别名|控件名|text|targetName|target_name)\s*[=:：]\s*([^\n,，;；)]+)/g,
  )) {
    pushUniqueCandidate(exactCandidates, { text: match[1] });
  }
  for (const match of text.matchAll(/路径[:：]\s*([^\n]+)/g)) {
    const segment = extractLastPathSegment(match[1]);
    if (segment) pushUniqueCandidate(exactCandidates, { text: segment });
  }
  for (const line of text.split(/\r?\n/)) {
    const segment = extractLastPathSegment(line);
    if (segment) pushUniqueCandidate(exactCandidates, { text: segment });
  }
  for (const term of extractQuotedTerms(text)) {
    pushUniqueCandidate(exactCandidates, { text: term });
  }

  const candidates = [];
  for (const candidate of [...exactCandidates, ...structuralCandidates]) {
    pushUniqueCandidate(candidates, candidate);
  }
  return candidates;
}

function extractMacdomCandidatesFromLocatePrompt(prompt) {
  const text = String(prompt || '').trim();
  const candidates = [];
  for (const term of extractQuotedTerms(text)) {
    pushUniqueCandidate(candidates, { text: term });
  }
  const stripped = stripPromptNoise(text);
  if (stripped && stripped.length >= 2) {
    pushUniqueCandidate(candidates, { text: stripped });
  }
  if (text && text.length >= 2 && text !== stripped) {
    pushUniqueCandidate(candidates, { text });
  }
  return candidates;
}

function normalizeModelCandidateKey(key) {
  const normalized = String(key || '').trim();
  const aliases = {
    objectName: 'object_name',
    object_name: 'object_name',
    object: 'object_name',
    className: 'class_name',
    class_name: 'class_name',
    text: 'text',
    label: 'text',
    name: 'text',
    keyword: 'text',
    term: 'text',
    toolTip: 'tool_tip',
    tooltip: 'tool_tip',
    tool_tip: 'tool_tip',
    special: 'special',
    xpath: 'xpath',
    path: 'xpath',
  };
  return aliases[normalized] || '';
}

function pushMacdomModelCandidate(candidates, value) {
  if (typeof value === 'string') {
    pushUniqueCandidate(candidates, { text: value });
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  const candidate = {};
  for (const [key, itemValue] of Object.entries(value)) {
    const normalizedKey = normalizeModelCandidateKey(key);
    if (!normalizedKey) continue;
    candidate[normalizedKey] = itemValue;
  }
  pushUniqueCandidate(candidates, candidate);
}

function parseMacdomCandidatesFromModelContent(content, limit) {
  const raw = String(content || '').trim();
  if (!raw) return [];

  const jsonText = raw.match(/\[[\s\S]*?\]/)?.[0] || raw;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    const candidates = [];
    for (const item of parsed) {
      pushMacdomModelCandidate(candidates, item);
    }
    return candidates.slice(0, limit);
  } catch {
    return [];
  }
}

function buildMacdomCandidateModelPrompt(prompt, options) {
  const knowledge = options.latestPlanningContext?.knowledge || '';
  return [
    '你是 MacDOM 控件定位候选生成器。',
    '请根据用户目标和知识库摘要，生成适合 MacDOM get-props 查询的 locator 候选。',
    '输出要求：',
    '- 只输出 JSON 数组，不要 Markdown，不要解释。',
    '- 数组项只能是字符串或对象。',
    '- 字符串会作为 text 候选。',
    '- 对象只允许字段：text, object_name, class_name, tool_tip, special, xpath。',
    '- objectName/className/toolTip/controlType 等知识库字段要转成 object_name/class_name/tool_tip。',
    '- 同一个对象里的多个字段是 AND 匹配；不确定时拆成多个单字段候选。',
    '- 优先给真实短控件名/选项名，例如“顶部按钮-传输列表”应补充“传输列表”。',
    '- 去掉动作词和泛化位置词，例如点击、打开、选择、顶部、按钮、列表、区域、界面，除非它们本身就是控件文字的一部分。',
    `- 最多 ${options.macdomCandidateLimit} 个，按最可能命中的顺序排列。`,
    '',
    `用户目标：${prompt}`,
    '',
    `知识库摘要：${knowledge || '(none)'}`,
  ].join('\n');
}

async function generateMacdomCandidatesWithModel(prompt, options) {
  if (!options.macdomCandidateModelEnabled) return [];

  const cacheKey = JSON.stringify({
    prompt,
    knowledge: options.latestPlanningContext?.knowledge || '',
    model:
      options.macdomCandidateModel ||
      options.queryTermModel ||
      options.model ||
      '',
  });
  if (options.macdomCandidateCache?.has(cacheKey)) {
    return options.macdomCandidateCache.get(cacheKey);
  }

  const model =
    options.macdomCandidateModel ||
    options.queryTermModel ||
    options.model ||
    'qwen3-vl:8b-instruct-q4_K_M';
  const response = await fetch(
    buildTargetUrl(options.target, '/v1/chat/completions'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer local',
      },
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: buildMacdomCandidateModelPrompt(prompt, options),
          },
        ],
        temperature: 0,
        top_p: 1,
        stream: false,
        max_tokens: options.queryTermModelMaxTokens,
      }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `macdom candidate model failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `macdom candidate model returned non-JSON: ${text.slice(0, 300)}`,
    );
  }

  const content = data?.choices?.[0]?.message?.content || '';
  const candidates = parseMacdomCandidatesFromModelContent(
    content,
    options.macdomCandidateLimit,
  );
  if (options.macdomCandidateCache) {
    if (options.macdomCandidateCache.size > 100) {
      options.macdomCandidateCache.clear();
    }
    options.macdomCandidateCache.set(cacheKey, candidates);
  }
  return candidates;
}

async function buildMacdomLocateCandidates(prompt, options) {
  const knowledgeCandidates = options.latestPlanningContext?.candidates?.length
    ? options.latestPlanningContext.candidates
    : extractMacdomCandidatesFromKnowledge(
        options.latestPlanningContext?.knowledge,
      );
  const promptCandidates = extractMacdomCandidatesFromLocatePrompt(prompt);
  let modelCandidates = [];
  try {
    modelCandidates = await generateMacdomCandidatesWithModel(prompt, options);
    if (modelCandidates.length) {
      logRequest(options, 'macdom candidates from model', {
        prompt,
        candidates: modelCandidates,
      });
    }
  } catch (error) {
    logRequest(options, 'macdom candidate model failed', {
      prompt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const candidates = [];
  for (const candidate of [
    ...modelCandidates,
    ...knowledgeCandidates,
    ...promptCandidates,
  ]) {
    pushExpandedCandidate(candidates, candidate);
  }
  return candidates;
}

function macdomPythonCommand(options) {
  const venvPython = pathJoin(options.macdomRepo, '.venv/bin/python3');
  return existsSync(venvPython) ? venvPython : 'python3';
}

function macdomDispatchScript(options) {
  return pathJoin(
    options.macdomRepo,
    DEFAULT_MACDOM_SKILL_RELATIVE_DIR,
    'scripts/macdom_dispatch.py',
  );
}

function macdomCandidateArgs(candidate) {
  const args = [];
  if (candidate.object_name) args.push('--object_name', candidate.object_name);
  if (candidate.text) args.push('--text', candidate.text);
  if (candidate.class_name) args.push('--class_name', candidate.class_name);
  if (candidate.tool_tip) args.push('--tool_tip', candidate.tool_tip);
  if (candidate.special) args.push('--special', candidate.special);
  if (candidate.xpath) args.push('--xpath', candidate.xpath);
  return args;
}

function parseMacdomJsonFromText(text) {
  const jsonText = String(text || '')
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith('{'));
  if (!jsonText) throw new Error(`macdom returned non-JSON: ${text}`);
  return JSON.parse(jsonText);
}

async function queryMacdomCandidatePython(candidate, options) {
  const args = [
    macdomDispatchScript(options),
    'get-props',
    '--base_url',
    options.macdomBaseUrl,
    ...macdomCandidateArgs(candidate),
    '--fields',
    'objectName,className,text,toolTip,special,visible,bounds',
    '--compact',
  ];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(macdomPythonCommand(options), args, {
      cwd: options.macdomRepo,
      timeout: options.macdomTimeoutMs,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    stdout = error?.stdout;
    if (!stdout) throw error;
  }
  const payload = parseMacdomJsonFromText(stdout);
  return payload?.success
    ? { ...payload, matchMode: 'get-props-exact' }
    : payload;
}

function macdomXmlUnescape(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseMacdomXmlAttributes(rawAttributes) {
  const attributes = {};
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = attrPattern.exec(String(rawAttributes || ''));
  while (match) {
    attributes[match[1]] = macdomXmlUnescape(match[2] ?? match[3] ?? '');
    match = attrPattern.exec(String(rawAttributes || ''));
  }
  return attributes;
}

function parseMacdomVisibleTreeNodes(xml) {
  const nodes = [];
  const tagPattern = /<([A-Za-z_][\w:.-]*)([^<>]*?)(?:\/>|>)/g;
  let match = tagPattern.exec(String(xml || ''));
  while (match) {
    const tag = match[1];
    if (tag.startsWith('?') || tag.startsWith('!')) {
      match = tagPattern.exec(String(xml || ''));
      continue;
    }

    const attributes = parseMacdomXmlAttributes(match[2]);
    const bounds = normalizeMacdomBounds({
      absX: attributes.absX,
      absY: attributes.absY,
      width: attributes.width,
      height: attributes.height,
    });
    if (!bounds) {
      match = tagPattern.exec(String(xml || ''));
      continue;
    }

    nodes.push({
      tag,
      objectName: attributes.objectName,
      className: attributes.className,
      text: attributes.text || '',
      toolTip: attributes.toolTip,
      special: attributes.special,
      visible: macdomStringLooksVisible(
        attributes.isInVisibleRect ?? attributes.visible,
      ),
      bounds,
    });
    match = tagPattern.exec(String(xml || ''));
  }
  return nodes;
}

function macdomStringLooksVisible(value) {
  if (value === undefined || value === null || value === '') return true;
  return !['false', '0', 'no'].includes(String(value).trim().toLowerCase());
}

function normalizeMacdomSearchText(value) {
  return String(value || '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/["'“”‘’]/g, '')
    .trim()
    .toLowerCase();
}

function macdomCandidateSearchValues(candidate) {
  const values = [];
  for (const [field, value] of Object.entries(normalizeCandidate(candidate))) {
    if (!value) continue;
    values.push({ field, value });
    if (['text', 'tool_tip', 'special'].includes(field)) {
      for (const variant of candidateValueVariants(value)) {
        values.push({ field, value: variant });
      }
    }
  }
  return values.filter(({ field, value }) => {
    if (['object_name', 'class_name', 'xpath'].includes(field)) return true;
    return !isGenericMacdomSearchValue(value);
  });
}

function isGenericMacdomSearchValue(value) {
  const normalized = normalizeMacdomSearchText(value);
  return [
    '按钮',
    '列表',
    '区域',
    '界面',
    '页面',
    '控件',
    '控件定位依据',
    '点击',
    '打开',
    '选择',
  ].includes(normalized);
}

function macdomNodeFieldValues(node, field) {
  const allSearchable = [
    node.text,
    node.toolTip,
    node.special,
    node.objectName,
    node.className,
    node.tag,
  ];
  if (field === 'object_name') return [node.objectName];
  if (field === 'class_name') return [node.className, node.tag];
  if (field === 'tool_tip') return [node.toolTip, ...allSearchable];
  if (field === 'special') return [node.special, ...allSearchable];
  if (field === 'text') return allSearchable;
  return [];
}

function scoreMacdomNodeMatch(node, candidate) {
  let score = 0;
  const matches = [];
  for (const { field, value } of macdomCandidateSearchValues(candidate)) {
    const needle = normalizeMacdomSearchText(value);
    if (!needle) continue;

    for (const nodeValue of macdomNodeFieldValues(node, field)) {
      const haystack = normalizeMacdomSearchText(nodeValue);
      if (!haystack) continue;

      const exact = haystack === needle;
      const contains = haystack.includes(needle);
      if (!exact && !contains) continue;

      const fieldScore =
        field === 'object_name'
          ? exact
            ? 120
            : 80
          : field === 'class_name'
            ? exact
              ? 70
              : 35
            : exact
              ? 60
              : 35;
      score = Math.max(score, fieldScore);
      matches.push({ field, value, nodeValue, exact });
      break;
    }
  }

  return { score, matches };
}

function macdomNodeToPayload(node, candidate, matchMode, score, matches) {
  return {
    success: true,
    locator: candidate,
    matchMode,
    score,
    matches,
    props: {
      objectName: node.objectName,
      className: node.className || node.tag,
      text: node.text || '',
      toolTip: node.toolTip,
      special: node.special,
      visible: node.visible,
      bounds: node.bounds,
    },
  };
}

async function fetchMacdomVisibleTreeNodes(options, queryContext) {
  if (queryContext?.visibleTreeNodesPromise) {
    return queryContext.visibleTreeNodesPromise;
  }

  const promise = (async () => {
    const url = new URL('/api/get_visible_tree', options.macdomBaseUrl);
    url.searchParams.set('compact', 'false');
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.macdomTimeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `macdom visible-tree failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return parseMacdomVisibleTreeNodes(text);
  })();

  if (queryContext) queryContext.visibleTreeNodesPromise = promise;
  return promise;
}

async function queryMacdomCandidateBuiltin(candidate, options, queryContext) {
  const nodes = await fetchMacdomVisibleTreeNodes(options, queryContext);
  const matches = [];
  for (const node of nodes) {
    if (!node.visible) continue;
    const result = scoreMacdomNodeMatch(node, candidate);
    if (result.score <= 0) continue;
    matches.push({ node, ...result });
  }

  if (!matches.length) {
    return {
      success: false,
      locator: candidate,
      error: 'No visible-tree node matched locator by contains',
    };
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftArea = left.node.bounds.width * left.node.bounds.height;
    const rightArea = right.node.bounds.width * right.node.bounds.height;
    return leftArea - rightArea;
  });

  const hit = matches[0];
  const exactObjectName = hit.matches.some(
    (match) => match.field === 'object_name' && match.exact,
  );
  return macdomNodeToPayload(
    hit.node,
    candidate,
    exactObjectName ? 'visible-tree-exact' : 'visible-tree-contains',
    hit.score,
    hit.matches,
  );
}

async function queryMacdomCandidate(candidate, options, queryContext) {
  if (options.macdomMode !== 'python') {
    return queryMacdomCandidateBuiltin(candidate, options, queryContext);
  }

  let exactPayload;
  try {
    exactPayload = await queryMacdomCandidatePython(candidate, options);
    if (
      exactPayload?.success &&
      macdomPayloadIsVisible(exactPayload) &&
      extractMacdomBounds(exactPayload)
    ) {
      return exactPayload;
    }
  } catch (error) {
    exactPayload = {
      success: false,
      locator: candidate,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return exactPayload;
}

function compactMacdomCandidate(candidate) {
  return Object.entries(candidate || {})
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function numberFromUnknown(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeMacdomBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return undefined;
  const x =
    numberFromUnknown(bounds.x) ??
    numberFromUnknown(bounds.left) ??
    numberFromUnknown(bounds.absX);
  const y =
    numberFromUnknown(bounds.y) ??
    numberFromUnknown(bounds.top) ??
    numberFromUnknown(bounds.absY);
  const width =
    numberFromUnknown(bounds.width) ??
    numberFromUnknown(bounds.w) ??
    (numberFromUnknown(bounds.right) !== undefined && x !== undefined
      ? numberFromUnknown(bounds.right) - x
      : undefined);
  const height =
    numberFromUnknown(bounds.height) ??
    numberFromUnknown(bounds.h) ??
    (numberFromUnknown(bounds.bottom) !== undefined && y !== undefined
      ? numberFromUnknown(bounds.bottom) - y
      : undefined);
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

function extractMacdomBounds(payload) {
  const props = payload?.props || payload;
  return normalizeMacdomBounds(
    props?.bounds || props?.rect || props?.geometry || props,
  );
}

function macdomPayloadIsVisible(payload) {
  const props = payload?.props || payload;
  if (props?.visible === undefined) return true;
  if (typeof props.visible === 'boolean') return props.visible;
  return !['false', '0', 'no'].includes(String(props.visible).toLowerCase());
}

function normalizeBboxTo1000(bounds, imageSize) {
  if (!imageSize?.width || !imageSize?.height) return undefined;
  const clamp = (value) => Math.max(0, Math.min(1000, Math.round(value)));
  return [
    clamp((bounds.x / imageSize.width) * 1000),
    clamp((bounds.y / imageSize.height) * 1000),
    clamp(((bounds.x + bounds.width) / imageSize.width) * 1000),
    clamp(((bounds.y + bounds.height) / imageSize.height) * 1000),
  ];
}

function resolveMacdomCoordinateSpace(options, imageSize) {
  if (options.macdomScreenSize?.width && options.macdomScreenSize?.height) {
    return {
      type: 'screen-logical',
      size: options.macdomScreenSize,
      source: 'configured',
    };
  }

  const detected = detectMacdomScreenSize();
  if (detected?.width && detected?.height) {
    options.macdomScreenSize = detected;
    return {
      type: 'screen-logical',
      size: detected,
      source: 'detected',
    };
  }

  return {
    type: 'image',
    size: imageSize,
    source: 'image',
  };
}

function detectMacdomScreenSize() {
  if (process.platform !== 'darwin') return undefined;

  try {
    const { stdout } = spawnSync(
      '/usr/bin/osascript',
      ['-e', 'tell application "Finder" to get bounds of window of desktop'],
      {
        timeout: 1000,
      },
    );
    const numbers = String(stdout || '')
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map(Number);
    if (!numbers || numbers.length < 4) return undefined;

    const width = numbers[2] - numbers[0];
    const height = numbers[3] - numbers[1];
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // Detection is best-effort; callers fall back to image coordinates.
  }

  return undefined;
}

function normalizeMacdomBoundsTo1000(bounds, imageSize, coordinateSpace) {
  if (!coordinateSpace?.size?.width || !coordinateSpace?.size?.height) {
    return normalizeBboxTo1000(bounds, imageSize);
  }

  const modelBounds =
    coordinateSpace.type === 'screen-logical'
      ? {
          x: (bounds.x / coordinateSpace.size.width) * imageSize.width,
          y: (bounds.y / coordinateSpace.size.height) * imageSize.height,
          width: (bounds.width / coordinateSpace.size.width) * imageSize.width,
          height:
            (bounds.height / coordinateSpace.size.height) * imageSize.height,
        }
      : bounds;

  return normalizeBboxTo1000(modelBounds, imageSize);
}

function buildMacdomLocateResponse(body, bbox, requestId, responseModel) {
  return {
    id: `chatcmpl-macdom-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: responseModel || body?.model || 'macdom-locate',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ bbox, errors: [] }),
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

function extractAssistantContentFromChatCompletionText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  try {
    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
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
  } catch {
    // Treat non-JSON target responses as raw assistant text.
  }

  return raw;
}

function extractActionParamJsonText(text) {
  const match = String(text || '').match(
    /<action-param-json\b[^>]*>([\s\S]*?)<\/action-param-json>/i,
  );
  return match?.[1]?.trim() || '';
}

function collectCoordinatePayloads(value, payloads = []) {
  if (Array.isArray(value)) {
    if (
      (value.length === 2 || value.length === 4) &&
      value.every((item) => Number.isFinite(Number(item)))
    ) {
      payloads.push(value.map(Number));
    }
    for (const item of value) {
      collectCoordinatePayloads(item, payloads);
    }
    return payloads;
  }

  if (!value || typeof value !== 'object') return payloads;

  for (const [key, itemValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      ['bbox', 'bbox_2d', 'locatedpixelbbox', 'point'].includes(normalizedKey)
    ) {
      collectCoordinatePayloads(itemValue, payloads);
    }
  }
  for (const itemValue of Object.values(value)) {
    collectCoordinatePayloads(itemValue, payloads);
  }
  return payloads;
}

function extractJsonObjectsFromText(text) {
  const source = String(text || '');
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== '}') continue;

    depth -= 1;
    if (depth === 0 && start >= 0) {
      objects.push(source.slice(start, index + 1));
      start = -1;
    } else if (depth < 0) {
      depth = 0;
      start = -1;
    }
  }

  return objects;
}

function extractCoordinatePayloadsFromText(text) {
  const payloads = [];
  const actionParamText = extractActionParamJsonText(text);
  const jsonCandidates = [
    actionParamText,
    ...extractJsonObjectsFromText(actionParamText),
    ...extractJsonObjectsFromText(text),
  ].filter(Boolean);

  for (const candidate of jsonCandidates) {
    try {
      collectCoordinatePayloads(JSON.parse(candidate), payloads);
    } catch {
      // Ignore malformed fragments; regex fallback below still catches arrays.
    }
  }

  const coordinatePattern =
    /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*)?\]/g;
  let match = coordinatePattern.exec(String(text || ''));
  while (match) {
    const numbers = [match[1], match[2], match[3], match[4]]
      .filter((value) => value !== undefined)
      .map(Number);
    if (numbers.length === 2 || numbers.length === 4) payloads.push(numbers);
    match = coordinatePattern.exec(String(text || ''));
  }

  return payloads;
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function coordinateDistance(left, right) {
  return Math.max(
    Math.abs(Number(left[0]) - Number(right[0])),
    Math.abs(Number(left[1]) - Number(right[1])),
  );
}

function bboxDistance(left, right) {
  return Math.max(
    Math.abs(Number(left[0]) - Number(right[0])),
    Math.abs(Number(left[1]) - Number(right[1])),
    Math.abs(Number(left[2]) - Number(right[2])),
    Math.abs(Number(left[3]) - Number(right[3])),
  );
}

function responseUsesMacdomBbox(responseText, bbox, options = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return {
      used: false,
      reason: 'missing_bbox',
      matchedPayload: undefined,
    };
  }

  const content = extractAssistantContentFromChatCompletionText(responseText);
  if (!content) {
    return {
      used: false,
      reason: 'empty_response',
      matchedPayload: undefined,
    };
  }

  const bboxTolerance =
    options.bboxTolerance ?? DEFAULT_MACDOM_USAGE_BBOX_TOLERANCE;
  const pointTolerance =
    options.pointTolerance ?? DEFAULT_MACDOM_USAGE_POINT_TOLERANCE;
  const center = bboxCenter(bbox);
  for (const payload of extractCoordinatePayloadsFromText(content)) {
    if (payload.length === 4 && bboxDistance(payload, bbox) <= bboxTolerance) {
      return {
        used: true,
        reason: 'bbox_match',
        matchedPayload: payload,
        content,
      };
    }
    if (
      payload.length === 2 &&
      coordinateDistance(payload, center) <= pointTolerance
    ) {
      return {
        used: true,
        reason: 'point_match',
        matchedPayload: payload,
        content,
      };
    }
  }

  return {
    used: false,
    reason: 'no_matching_coordinate',
    matchedPayload: undefined,
    content,
  };
}

function logMacdomPlanningUsage(options, responseText, macdomPlanningHit) {
  const hit = macdomPlanningHit || options.latestMacdomPlanningHit;
  if (!hit?.bbox) return;

  const usage = responseUsesMacdomBbox(responseText, hit.bbox);
  logRequest(options, 'macdom planning usage check', {
    traceId: hit.traceId,
    instruction: hit.instruction,
    candidate: hit.candidate,
    bbox: hit.bbox,
    used: usage.used,
    reason: usage.reason,
    matchedPayload: usage.matchedPayload,
    responsePreview: String(usage.content || '').slice(0, 500),
  });
}

async function resolveMacdomHit(prompt, imageSize, options, logPrefix) {
  const candidates = await buildMacdomLocateCandidates(prompt, options);
  if (options.macdomDebug) {
    logRequest(options, `${logPrefix} candidates`, {
      prompt,
      imageSize,
      candidates,
    });
  }
  if (!candidates.length) {
    logRequest(options, `${logPrefix} miss`, {
      prompt,
      reason: 'no_candidates',
    });
    return undefined;
  }

  const queryContext = {};
  for (const candidate of candidates) {
    try {
      const payload = await queryMacdomCandidate(
        candidate,
        options,
        queryContext,
      );
      const bounds = extractMacdomBounds(payload);
      if (!payload?.success || !macdomPayloadIsVisible(payload) || !bounds) {
        if (options.macdomDebug) {
          logRequest(options, `${logPrefix} miss`, {
            prompt,
            candidate,
            success: payload?.success,
            visible: macdomPayloadIsVisible(payload),
            hasBounds: Boolean(bounds),
          });
        }
        continue;
      }

      const coordinateSpace = resolveMacdomCoordinateSpace(options, imageSize);
      const bbox = normalizeMacdomBoundsTo1000(
        bounds,
        imageSize,
        coordinateSpace,
      );
      if (!bbox) {
        logRequest(options, `${logPrefix} miss`, {
          prompt,
          candidate,
          reason: 'invalid_normalized_bbox',
          coordinateSpace,
        });
        continue;
      }

      logRequest(options, `${logPrefix} hit`, {
        prompt,
        candidate,
        bounds,
        matchMode: payload?.matchMode,
        matchedProps: payload?.props,
        matches: payload?.matches,
        coordinateSpace,
        bbox,
      });
      return {
        candidate,
        bounds,
        matchMode: payload?.matchMode,
        matchedProps: payload?.props,
        coordinateSpace,
        bbox,
      };
    } catch (error) {
      if (options.macdomDebug) {
        logRequest(options, `${logPrefix} miss`, {
          prompt,
          candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logRequest(options, `${logPrefix} miss`, {
    prompt,
    candidates: candidates.length,
    reason: 'no_visible_bounds',
  });
  return undefined;
}

function buildMacdomPlanningKnowledge(hit) {
  if (!hit) return '';
  return [
    'MacDOM 当前界面实时定位到以下控件坐标。',
    hit.traceId ? `traceId: ${hit.traceId}` : '',
    `候选: ${compactMacdomCandidate(hit.candidate)}`,
    hit.matchMode ? `MacDOM match mode: ${hit.matchMode}` : '',
    `bounds: x=${hit.bounds.x}, y=${hit.bounds.y}, width=${hit.bounds.width}, height=${hit.bounds.height}`,
    hit.coordinateSpace
      ? `MacDOM bounds coordinate space: ${hit.coordinateSpace.type} (${hit.coordinateSpace.size.width}x${hit.coordinateSpace.size.height}, ${hit.coordinateSpace.source})`
      : '',
    `qwen3-vl normalized bbox: [${hit.bbox.join(', ')}]`,
    '如果下一步操作目标就是该控件，可以直接在 action-param-json 的 locate 中使用这个 bbox；实际点击/输入/滚动仍由 Midscene 原 Action Space 执行。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function buildMacdomPlanningKnowledgeFromBody(
  body,
  instruction,
  options,
  requestId,
) {
  if (!options.macdomLocate) {
    logRequest(options, 'macdom planning skipped', { reason: 'disabled' });
    options.latestMacdomPlanningHit = undefined;
    return '';
  }
  if (!instruction) {
    logRequest(options, 'macdom planning skipped', {
      reason: 'missing_instruction',
    });
    options.latestMacdomPlanningHit = undefined;
    return '';
  }

  const imageSize = extractFirstImageSize(body);
  if (!imageSize) {
    logRequest(options, 'macdom planning skipped', {
      reason: 'missing_image_size',
    });
    options.latestMacdomPlanningHit = undefined;
    return '';
  }

  const hit = await resolveMacdomHit(
    instruction,
    imageSize,
    options,
    'macdom planning',
  );
  if (hit) {
    hit.traceId = `macdom-${requestId || Date.now()}`;
    hit.instruction = instruction;
    options.latestMacdomPlanningHit = {
      ...hit,
      imageSize,
      updatedAt: Date.now(),
    };
  } else {
    options.latestMacdomPlanningHit = undefined;
  }
  return buildMacdomPlanningKnowledge(hit);
}

async function tryBuildMacdomLocateResponse(
  body,
  options,
  requestId,
  responseModel,
) {
  if (!options.macdomLocate) {
    logRequest(options, 'macdom locate skipped', { reason: 'disabled' });
    return undefined;
  }
  if (!requestLooksLikeMidsceneLocate(body)) {
    return undefined;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const prompt = extractLocatePromptFromMessages(messages);
  const imageSize = extractFirstImageSize(body);
  if (!prompt || !imageSize) {
    logRequest(options, 'macdom locate skipped', {
      reason: !prompt ? 'missing_prompt' : 'missing_image_size',
    });
    return undefined;
  }

  const hit = await resolveMacdomHit(
    prompt,
    imageSize,
    options,
    'macdom locate',
  );
  if (hit) {
    return buildMacdomLocateResponse(body, hit.bbox, requestId, responseModel);
  }

  logRequest(options, 'macdom locate fallback forwarded', {
    prompt,
  });
  return undefined;
}

async function queryWikiIndex(query, options) {
  const cacheKey = JSON.stringify({
    query,
    topK: options.topK,
    scopes: options.scopes,
    viaMcp: options.useWikiMcp,
  });
  if (options.wikiCache?.has(cacheKey)) {
    return options.wikiCache.get(cacheKey);
  }

  const result = options.useWikiMcp
    ? await queryWikiIndexViaMcp(query, options)
    : await queryWikiIndexViaCli(query, options);

  if (options.wikiCache) {
    if (options.wikiCache.size > 100) options.wikiCache.clear();
    options.wikiCache.set(cacheKey, result);
  }
  return result;
}

async function queryWikiIndexViaCli(query, options) {
  const args = [
    options.queryScript,
    query,
    '--view',
    'both',
    '--compact',
    '--json',
    '--top-k',
    String(options.topK),
  ];
  for (const scope of options.scopes || []) {
    args.push('--scope', scope);
  }

  const { stdout } = await execFileAsync('python3', args, {
    cwd: options.queryCwd,
    timeout: options.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function createMcpStdioClient(options) {
  const child = spawn(options.wikiMcpCommand, options.wikiMcpArgs, {
    cwd: options.wikiMcpCwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdoutBuffer = '';
  let closed = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    while (stdoutBuffer.includes('\n')) {
      const lineEnd = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, lineEnd).trim();
      stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        logRequest(options, 'wiki MCP returned invalid JSON line', {
          line: line.slice(0, 300),
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(message, 'id')) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);

      if (message.error) {
        request.reject(
          new Error(
            message.error.message ||
              `MCP request failed: ${JSON.stringify(message.error)}`,
          ),
        );
      } else {
        request.resolve(message.result);
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const text = chunk.trim();
    if (text && options.debug) {
      console.error(`[wiki-midscene-adapter][wiki-mcp] ${text}`);
    }
  });

  child.on('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });

  child.on('close', (code, signal) => {
    closed = true;
    const error = new Error(
      `wiki MCP process closed${code === null ? '' : ` with code ${code}`}${
        signal ? ` signal ${signal}` : ''
      }`,
    );
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });

  function send(method, params, { notification = false } = {}) {
    if (closed || !child.stdin.writable) {
      throw new Error('wiki MCP process is not available');
    }

    const message = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: ++mcpRequestSerial, method, params };
    child.stdin.write(`${JSON.stringify(message)}\n`);
    if (notification) return Promise.resolve(undefined);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id);
        reject(new Error(`wiki MCP request timed out: ${method}`));
      }, options.timeoutMs);
      pending.set(message.id, { resolve, reject, timer });
    });
  }

  async function initialize() {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'wiki-midscene-adapter',
        version: '0.1.0',
      },
    });
    await send('notifications/initialized', {}, { notification: true });
  }

  return {
    initialize,
    send,
    close() {
      child.kill();
    },
  };
}

async function getWikiMcpClient(options) {
  if (!options.wikiMcpClient) {
    const client =
      options.wikiMcpType === 'http'
        ? createMcpHttpClient(options)
        : createMcpStdioClient(options);
    await client.initialize();
    options.wikiMcpClient = client;
    logRequest(options, 'wiki MCP client initialized', {
      type: options.wikiMcpType,
      ...(options.wikiMcpType === 'http'
        ? {
            url: options.wikiMcpUrl,
            headers: Object.keys(options.wikiMcpHeaders || {}),
          }
        : {
            command: options.wikiMcpCommand,
            args: options.wikiMcpArgs,
          }),
      tool: options.wikiMcpTool,
    });
  }
  return options.wikiMcpClient;
}

function createMcpHttpClient(options) {
  if (!options.wikiMcpUrl) {
    throw new Error('Missing wiki MCP HTTP URL');
  }

  async function send(method, params, { notification = false } = {}) {
    const message = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: ++mcpRequestSerial, method, params };

    const response = await fetch(options.wikiMcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...options.wikiMcpHeaders,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify(message),
    });

    if (notification && (response.status === 202 || response.ok)) {
      return undefined;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `wiki MCP HTTP request failed (${response.status}): ${text.slice(
          0,
          300,
        )}`,
      );
    }

    if (notification || !text.trim()) return undefined;

    const data = parseMcpHttpResponseText(text);
    if (data?.error) {
      throw new Error(
        data.error.message ||
          `MCP request failed: ${JSON.stringify(data.error)}`,
      );
    }
    return data?.result;
  }

  async function initialize() {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'wiki-midscene-adapter',
        version: '0.1.0',
      },
    });
    await send('notifications/initialized', {}, { notification: true });
  }

  return {
    initialize,
    send,
    close() {},
  };
}

function parseMcpHttpResponseText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLines = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    const dataText = dataLines.join('\n').trim();
    return dataText ? JSON.parse(dataText) : undefined;
  }

  return JSON.parse(trimmed);
}

function scoreMcpTool(tool) {
  const name = String(tool?.name || '').toLowerCase();
  if (name === 'wiki_search') return 100;
  if (name === 'fusion_query') return 90;
  if (name.includes('wiki_search')) return 80;

  const text = `${name} ${tool?.description || ''}`.toLowerCase();
  let score = 0;
  if (name.startsWith('code_')) score -= 20;
  if (name.startsWith('doc_')) score -= 10;
  for (const word of ['wiki', 'knowledge', 'kb', 'graph', 'search', 'query']) {
    if (text.includes(word)) score += 5;
  }
  if (text.includes('control') || text.includes('ui_')) score -= 3;
  return score;
}

async function resolveWikiMcpTool(options, client) {
  if (options.wikiMcpResolvedTool) return options.wikiMcpResolvedTool;
  if (options.wikiMcpTool) {
    options.wikiMcpResolvedTool = options.wikiMcpTool;
    return options.wikiMcpResolvedTool;
  }

  const list = await client.send('tools/list', {});
  const tools = Array.isArray(list?.tools) ? list.tools : [];
  options.wikiMcpAvailableTools = tools
    .map((tool) => tool?.name)
    .filter(Boolean);
  if (!tools.length) throw new Error('wiki MCP server returned no tools');

  const selected = [...tools].sort((left, right) => {
    return scoreMcpTool(right) - scoreMcpTool(left);
  })[0];
  if (!selected?.name)
    throw new Error('wiki MCP server returned unnamed tools');

  options.wikiMcpResolvedTool = selected.name;
  logRequest(options, 'wiki MCP tool selected', {
    tool: selected.name,
    availableTools: options.wikiMcpAvailableTools,
  });
  return options.wikiMcpResolvedTool;
}

async function queryWikiIndexViaMcp(query, options) {
  const client = await getWikiMcpClient(options);
  const toolName = await resolveWikiMcpTool(options, client);
  const response = await client.send('tools/call', {
    name: toolName,
    arguments: buildWikiMcpToolArguments(query, options),
  });
  logRequest(options, 'wiki MCP tool response', {
    query,
    tool: toolName,
    summary: summarizeMcpResponseForLog(response),
  });

  if (response?.isError) {
    const text = response.content
      ?.map((item) => (item?.type === 'text' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(text || 'wiki MCP tool returned an error');
  }

  return normalizeMcpToolResult(response, query);
}

function summarizeMcpResponseForLog(response) {
  if (!response || typeof response !== 'object') return response;
  const content = Array.isArray(response.content) ? response.content : [];
  return {
    isError: Boolean(response.isError),
    contentTypes: content.map((item) => item?.type).filter(Boolean),
    textPreview: content
      .map((item) => (item?.type === 'text' ? String(item.text || '') : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 300),
  };
}

function buildWikiMcpToolArguments(query, options) {
  const args = {
    query,
    q: query,
    keyword: query,
    text: query,
    topK: options.topK,
    top_k: options.topK,
    limit: options.topK,
    scopes: options.scopes,
    scope: options.scopes,
    view: 'both',
    compact: true,
  };
  if (options.wikiMcpRepoId) {
    args.repo_id = options.wikiMcpRepoId;
    args.repoId = options.wikiMcpRepoId;
  }
  return args;
}

function normalizeMcpToolResult(response, query) {
  const content = Array.isArray(response?.content) ? response.content : [];
  const textParts = [];
  const jsonParts = [];

  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text' && item.text) textParts.push(String(item.text));
    if (item.type === 'json') jsonParts.push(item.json ?? item.data);
    if (item.type === 'resource' && item.resource?.text) {
      textParts.push(String(item.resource.text));
    }
  }

  if (jsonParts.length) {
    return jsonParts[0];
  }

  const text = textParts.join('\n').trim();
  if (!text) {
    return {
      query,
      match_count: 0,
      knowledge_text: JSON.stringify(response),
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      query,
      match_count: 1,
      knowledge_text: text,
    };
  }
}

async function buildWikiKnowledge(instruction, options, requestModel) {
  if (!options.enabled) return '';
  if (options.knowledgeProvider === 'claude') {
    return buildClaudeKnowledge(instruction, options);
  }

  if (!options.useWikiMcp && !options.queryScript) return '';

  const terms = await resolveWikiQueryTerms(instruction, options, requestModel);
  if (!terms.length) return '';

  logRequest(options, 'wiki query terms', {
    terms,
    topK: options.topK,
    scopes: options.scopes,
  });

  const snippets = [];
  for (const term of terms) {
    try {
      const result = await queryWikiIndex(term, options);
      const summary = summarizeWikiResult(result);
      if (summary) snippets.push(summary);
      logRequest(options, 'wiki query result', {
        term,
        matchCount: getKnowledgeMatchCount(result),
        injected: Boolean(summary),
      });
    } catch (error) {
      logRequest(options, 'wiki query failed', {
        term,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!snippets.length) return '';

  const knowledge = truncateKnowledge(
    [
      '本地知识库为本次 Midscene 规划查询到以下页面路径/控件定位依据。',
      '如果目标控件当前截图不可见，请先根据路径规划导航到对应页面或分区，不要仅因当前截图未显示目标就判定任务不可满足。',
      '具体下一步仍必须以当前截图可见或可定位的控件为准，不要只凭知识库虚构完成。',
      '',
      snippets.join('\n\n'),
    ].join('\n'),
    options.maxKnowledgeChars,
  );
  return {
    knowledge,
    terms,
  };
}

function buildClaudePrompt(instruction) {
  return [
    '你是 Midscene 规划前的知识库查询器。',
    '请只使用已配置的 kbgraph MCP 工具查询和总结，不要修改文件，不要执行项目命令。',
    '目标：为后续视觉自动化规划提供高置信的页面路径、控件名称、定位信息、操作能力和注意事项。',
    '如果直接查询为空，请自主选择更合适的 kbgraph 工具继续查询一次或多次，例如 fusion_query、ui_search_controls、ui_get_control、wiki_search。',
    '输出要求：',
    '- 只输出可注入给规划模型的简短中文知识摘要。',
    '- 优先保留路径、控件名、objectName、text、controlType、abilities。',
    '- 如果没有可靠命中，输出空字符串或“NO_RELEVANT_KNOWLEDGE”。',
    '- 不要输出 Markdown 代码块，不要解释你的查询过程。',
    '',
    `用户指令：${instruction}`,
  ].join('\n');
}

function buildClaudeArgs(instruction, options) {
  const args = ['-p'];
  if (options.claudeSkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }
  if (options.claudeOutputFormat) {
    args.push('--output-format', options.claudeOutputFormat);
  }
  if (options.claudeOutputFormat === 'stream-json') {
    args.push('--verbose');
  }
  if (options.claudeMcpConfig) {
    args.push('--mcp-config', options.claudeMcpConfig);
  }
  if (options.claudeModel) {
    args.push('--model', options.claudeModel);
  }
  args.push(...options.claudeArgs);
  args.push(buildClaudePrompt(instruction));
  return args;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function execClaude(args, options) {
  if (!options.claudeShell && /\s/.test(options.claudeCommand.trim())) {
    throw new Error(
      `Invalid claude command "${options.claudeCommand}". Pass an absolute executable path, or use --claude-shell.`,
    );
  }

  if (options.claudeShell) {
    const shell = process.env.SHELL || '/bin/zsh';
    const command = [options.claudeCommand, ...args].map(shellQuote).join(' ');
    return execFileAsync(shell, ['-lc', command], {
      cwd: options.claudeCwd || process.cwd(),
      timeout: options.claudeTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
  }

  return execFileAsync(options.claudeCommand, args, {
    cwd: options.claudeCwd || process.cwd(),
    timeout: options.claudeTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function parseClaudeOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';

  if (!text.includes('\n')) {
    try {
      const data = JSON.parse(text);
      return (
        data?.result || extractAssistantTextFromClaudeMessage(data) || text
      );
    } catch {
      return text;
    }
  }

  let result = '';
  const assistantTexts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (data?.type === 'result' && typeof data.result === 'string') {
        result = data.result;
      }
      const assistantText = extractAssistantTextFromClaudeMessage(data);
      if (assistantText) assistantTexts.push(assistantText);
    } catch {
      assistantTexts.push(line);
    }
  }

  return result || assistantTexts.join('\n').trim();
}

function extractAssistantTextFromClaudeMessage(data) {
  const content = data?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => String(item.text))
    .join('\n')
    .trim();
}

function normalizeClaudeKnowledge(text) {
  const normalized = String(text || '').trim();
  if (!normalized || /^NO_RELEVANT_KNOWLEDGE$/i.test(normalized)) return '';
  return normalized;
}

function explainSkippedClaudeKnowledge(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 'empty_output';
  if (/^NO_RELEVANT_KNOWLEDGE$/i.test(normalized)) {
    return 'no_relevant_knowledge';
  }
  return 'filtered_output';
}

function getClaudeKnowledgeCacheKey(instruction, options) {
  if (options.claudeCacheMode === 'off') return '';
  if (options.claudeCacheMode === 'once') return '__once__';
  return JSON.stringify({
    instruction,
    config: options.claudeMcpConfig,
    model: options.claudeModel,
    cwd: options.claudeCwd,
    args: options.claudeArgs,
  });
}

async function buildClaudeKnowledge(instruction, options) {
  const cacheKey = getClaudeKnowledgeCacheKey(instruction, options);
  if (cacheKey) {
    const cached =
      cacheKey === '__once__'
        ? options.claudeOnceKnowledge
        : options.claudeKnowledgeCache.get(cacheKey);
    if (cached !== undefined) {
      const cachedKnowledge = typeof cached === 'string' ? '' : cached;
      logRequest(options, 'claude knowledge cache hit', {
        mode: options.claudeCacheMode,
        injected: Boolean(cachedKnowledge?.knowledge),
        skippedReason: cachedKnowledge?.skippedReason,
      });
      if (cachedKnowledge?.knowledge) {
        logKnowledge(
          options,
          'claude knowledge cache content',
          cachedKnowledge.knowledge,
        );
      } else if (cachedKnowledge?.rawKnowledge) {
        logKnowledge(
          options,
          'claude knowledge cache skipped content',
          cachedKnowledge.rawKnowledge,
        );
      }
      return cachedKnowledge?.knowledge ? cachedKnowledge : '';
    }
  }

  const args = buildClaudeArgs(instruction, options);
  logRequest(options, 'claude knowledge query', {
    command: options.claudeCommand,
    shell: options.claudeShell,
    cwd: options.claudeCwd || process.cwd(),
    args: args.map((arg) =>
      String(arg).includes('Bearer ') ? '<redacted>' : String(arg),
    ),
  });

  try {
    const { stdout, stderr } = await execClaude(args, options);
    const rawKnowledge = String(parseClaudeOutput(stdout) || '').trim();
    const knowledge = normalizeClaudeKnowledge(rawKnowledge);
    const skippedReason = knowledge
      ? undefined
      : explainSkippedClaudeKnowledge(rawKnowledge);
    logRequest(options, 'claude knowledge result', {
      injected: Boolean(knowledge),
      knowledgeChars: knowledge.length,
      rawKnowledgeChars: rawKnowledge.length,
      skippedReason,
      stderr: options.debug ? stderr.slice(0, 300) : undefined,
    });
    logKnowledge(
      options,
      knowledge
        ? 'claude knowledge content'
        : 'claude knowledge skipped content',
      knowledge || rawKnowledge,
    );
    if (!rawKnowledge && stdout && options.debug) {
      logKnowledge(options, 'claude raw stdout content', stdout);
    }
    if (!knowledge) {
      const emptyResult = {
        knowledge: '',
        rawKnowledge,
        skippedReason,
        terms: [instruction],
      };
      if (cacheKey === '__once__') options.claudeOnceKnowledge = emptyResult;
      if (cacheKey && cacheKey !== '__once__') {
        options.claudeKnowledgeCache.set(cacheKey, emptyResult);
      }
      return '';
    }

    const result = {
      knowledge: truncateKnowledge(
        [
          'Claude 已通过 kbgraph MCP 为本次 Midscene 规划查询到以下页面路径/控件定位依据。',
          '如果目标控件当前截图不可见，请先根据路径规划导航到对应页面或分区，不要仅因当前截图未显示目标就判定任务不可满足。',
          '具体下一步仍必须以当前截图可见或可定位的控件为准，不要只凭知识库虚构完成。',
          '',
          knowledge,
        ].join('\n'),
        options.maxKnowledgeChars,
      ),
      terms: [instruction],
    };
    if (cacheKey === '__once__') options.claudeOnceKnowledge = result;
    if (cacheKey && cacheKey !== '__once__') {
      if (options.claudeKnowledgeCache.size > 100) {
        options.claudeKnowledgeCache.clear();
      }
      options.claudeKnowledgeCache.set(cacheKey, result);
    }
    return result;
  } catch (error) {
    logRequest(options, 'claude knowledge failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

function injectKnowledgeIntoText(text, knowledge) {
  const escapedKnowledge = xmlEscape(knowledge);
  const highPriorityPattern =
    /<high_priority_knowledge\b[^>]*>([\s\S]*?)<\/high_priority_knowledge>/i;

  if (highPriorityPattern.test(text)) {
    return text.replace(highPriorityPattern, (full, existing) => {
      const existingText = String(existing || '').trim();
      const nextKnowledge = existingText
        ? `${existingText}\n\n${escapedKnowledge}`
        : escapedKnowledge;
      return `<high_priority_knowledge>${nextKnowledge}</high_priority_knowledge>`;
    });
  }

  const block = `<high_priority_knowledge>${escapedKnowledge}</high_priority_knowledge>\n`;
  if (/<user_instruction\b/i.test(text)) {
    return text.replace(/<user_instruction\b/i, `${block}<user_instruction`);
  }

  return `${block}${text}`;
}

function injectHighPriorityKnowledge(body, knowledge) {
  if (!knowledge.trim()) return body;

  const requestBody = structuredClone(body);
  const messages = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : [];

  let targetMessage = messages.find(
    (message) =>
      message?.role !== 'system' &&
      contentToText(message.content).includes('<user_instruction'),
  );
  if (!targetMessage) {
    targetMessage = messages.find((message) => message?.role === 'user');
  }
  if (!targetMessage) return requestBody;

  if (typeof targetMessage.content === 'string') {
    targetMessage.content = injectKnowledgeIntoText(
      targetMessage.content,
      knowledge,
    );
    return requestBody;
  }

  if (Array.isArray(targetMessage.content)) {
    let targetPart = targetMessage.content.find(
      (part) =>
        part?.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.includes('<user_instruction'),
    );
    if (!targetPart) {
      targetPart = targetMessage.content.find(
        (part) => part?.type === 'text' && typeof part.text === 'string',
      );
    }

    if (targetPart) {
      targetPart.text = injectKnowledgeIntoText(targetPart.text, knowledge);
    } else {
      targetMessage.content.unshift({
        type: 'text',
        text: injectKnowledgeIntoText('', knowledge),
      });
    }
  }

  return requestBody;
}

function applyModelOverride(body, options) {
  if (!options.model || !body || typeof body !== 'object') return body;

  return {
    ...body,
    model: options.model,
  };
}

async function enrichPlanningRequest(body, options, requestId) {
  if (!requestLooksLikeMidscenePlanning(body)) {
    options.latestMacdomPlanningHit = undefined;
    return body;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const instruction = extractMidsceneUserInstruction(messages);
  if (!instruction) return body;

  const knowledgeParts = [];
  const wikiResult = await buildWikiKnowledge(
    instruction,
    options,
    body?.model,
  );
  if (wikiResult) {
    logRequest(options, 'planning request enriched', {
      instruction,
      queryTerms: wikiResult.terms,
      knowledgeChars: wikiResult.knowledge.length,
    });
    options.latestPlanningContext = {
      instruction,
      terms: wikiResult.terms,
      knowledge: wikiResult.knowledge,
      candidates: extractMacdomCandidatesFromKnowledge(wikiResult.knowledge),
      updatedAt: Date.now(),
    };
    knowledgeParts.push(wikiResult.knowledge);
  } else {
    logRequest(options, 'planning request passed without wiki knowledge', {
      instruction,
    });
    options.latestPlanningContext = {
      instruction,
      terms: [],
      knowledge: '',
      candidates: [],
      updatedAt: Date.now(),
    };
  }

  const macdomKnowledge = await buildMacdomPlanningKnowledgeFromBody(
    body,
    instruction,
    options,
    requestId,
  );
  if (macdomKnowledge) {
    logRequest(options, 'planning request enriched with macdom', {
      instruction,
      knowledgeChars: macdomKnowledge.length,
    });
    knowledgeParts.push(macdomKnowledge);
  }

  if (!knowledgeParts.length) return body;

  const knowledge = truncateKnowledge(
    knowledgeParts.join('\n\n'),
    options.maxKnowledgeChars,
  );
  logKnowledge(options, 'planning injected knowledge', knowledge);

  return injectHighPriorityKnowledge(body, knowledge);
}

async function forwardToTarget({
  target,
  pathname,
  search,
  method,
  headers,
  body,
}) {
  const targetUrl = buildTargetUrl(target, pathname, search);
  const requestHeaders = {
    'content-type': headers['content-type'] || 'application/json',
    authorization: headers.authorization || 'Bearer local',
  };

  return fetch(targetUrl, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body } : {}),
  });
}

function createServer(options) {
  return http.createServer(async (req, res) => {
    const requestId = ++requestSerial;
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      logRequest(options, `#${requestId} incoming`, {
        method: req.method,
        path: `${url.pathname}${url.search}`,
      });

      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        logRequest(options, `#${requestId} handled OPTIONS`, { status: 204 });
        return;
      }

      if (req.method === 'POST' && isChatCompletionsPath(url.pathname)) {
        const body = await readJsonBody(req);
        const modelBody = applyModelOverride(body, options);
        const isPlanning = requestLooksLikeMidscenePlanning(body);
        logRequest(options, `#${requestId} chat request`, {
          planning: isPlanning,
          locate: requestLooksLikeMidsceneLocate(modelBody),
          model: modelBody?.model,
          originalModel: body?.model,
          modelOverridden: modelBody !== body,
        });
        const enrichedBody = await enrichPlanningRequest(
          modelBody,
          options,
          requestId,
        );
        const macdomPlanningHit = options.latestMacdomPlanningHit;
        const macdomLocateResponse = await tryBuildMacdomLocateResponse(
          enrichedBody,
          options,
          requestId,
          body?.model,
        );
        if (macdomLocateResponse) {
          sendJson(res, 200, macdomLocateResponse);
          return;
        }
        const response = await forwardToTarget({
          target: options.target,
          pathname: url.pathname,
          search: url.search,
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(enrichedBody),
        });
        const text = await response.text();
        if (isPlanning) {
          logMacdomPlanningUsage(options, text, macdomPlanningHit);
        }
        logRequest(options, `#${requestId} forwarded`, {
          target: buildTargetUrl(options.target, url.pathname, url.search),
          status: response.status,
          enriched: enrichedBody !== body,
        });
        sendProxyResponse(res, response, text);
        return;
      }

      const rawBody =
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : await readRawBody(req);
      const response = await forwardToTarget({
        target: options.target,
        pathname: url.pathname,
        search: url.search,
        method: req.method || 'GET',
        headers: req.headers,
        body: rawBody,
      });
      const text = await response.text();
      logRequest(options, `#${requestId} proxied`, {
        target: buildTargetUrl(options.target, url.pathname, url.search),
        status: response.status,
      });
      sendProxyResponse(res, response, text);
    } catch (error) {
      console.error('[wiki-midscene-adapter]', error);
      sendJson(res, 500, {
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

function startServer(options) {
  const server = createServer(options);
  server.listen(options.port, options.host, () => {
    console.log(
      `Wiki Midscene adapter listening on http://${options.host}:${options.port}/v1`,
    );
    console.log(`Forwarding requests to ${options.target}`);
    console.log(
      `Forwarded model override: ${options.model || '(preserve request model)'}`,
    );
    console.log(`Knowledge provider: ${options.knowledgeProvider}`);
    if (options.knowledgeProvider === 'claude') {
      console.log(`Claude command: ${options.claudeCommand}`);
      console.log(`Claude shell mode: ${options.claudeShell}`);
      console.log(`Claude cwd: ${options.claudeCwd || process.cwd()}`);
      console.log(`Claude MCP config: ${options.claudeMcpConfig || '(none)'}`);
      console.log(`Claude timeoutMs: ${options.claudeTimeoutMs}`);
      console.log(`Claude cache mode: ${options.claudeCacheMode}`);
    }
    console.log(`Wiki repo: ${options.wikiRepo}`);
    console.log(`Wiki skill dir: ${options.skillDir}`);
    console.log(`Wiki query script: ${options.queryScript}`);
    console.log(`Wiki query cwd: ${options.queryCwd}`);
    console.log(
      `Wiki query mode: ${options.useWikiMcp ? 'mcp' : 'python-cli'}`,
    );
    if (options.useWikiMcp) {
      if (options.wikiMcpType === 'http') {
        console.log(`Wiki MCP url: ${options.wikiMcpUrl}`);
        console.log(
          `Wiki MCP headers: ${Object.keys(options.wikiMcpHeaders || {}).join(
            ', ',
          )}`,
        );
      } else {
        console.log(
          `Wiki MCP command: ${options.wikiMcpCommand} ${options.wikiMcpArgs.join(
            ' ',
          )}`,
        );
      }
      console.log(`Wiki MCP tool: ${options.wikiMcpTool}`);
    }
    console.log(
      `Wiki query topK=${options.topK}; limit=${options.queryLimit}; enabled=${options.enabled}`,
    );
    console.log(
      `Knowledge logging: ${options.logKnowledge ? 'full' : `preview ${options.logKnowledgeChars} chars`}`,
    );
    console.log(
      `MacDOM locate: ${options.macdomLocate ? 'enabled' : 'disabled'}`,
    );
    if (options.macdomLocate) {
      console.log(`MacDOM mode: ${options.macdomMode}`);
      if (options.macdomMode === 'python') {
        console.log(`MacDOM repo: ${options.macdomRepo}`);
      }
      console.log(`MacDOM base url: ${options.macdomBaseUrl}`);
      console.log(
        `MacDOM screen size: ${
          options.macdomScreenSize
            ? `${options.macdomScreenSize.width}x${options.macdomScreenSize.height}`
            : '(auto-detect)'
        }`,
      );
      console.log(`MacDOM timeoutMs: ${options.macdomTimeoutMs}`);
      console.log(`MacDOM debug: ${options.macdomDebug}`);
      console.log(
        `MacDOM candidate model: ${
          options.macdomCandidateModelEnabled
            ? options.macdomCandidateModel ||
              options.queryTermModel ||
              options.model ||
              '(request/default model)'
            : 'disabled'
        }`,
      );
      console.log(`MacDOM candidate limit: ${options.macdomCandidateLimit}`);
    }
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
  applyModelOverride,
  buildWikiKnowledge,
  buildClaudeArgs,
  buildClaudePrompt,
  createServer,
  enrichPlanningRequest,
  extractMidsceneUserInstruction,
  extractMacdomCandidatesFromKnowledge,
  normalizeBboxTo1000,
  normalizeMacdomBoundsTo1000,
  extractAssistantContentFromChatCompletionText,
  injectHighPriorityKnowledge,
  parseArgs,
  parseClaudeOutput,
  requestLooksLikeMidsceneLocate,
  requestLooksLikeMidscenePlanning,
  responseUsesMacdomBbox,
  summarizeWikiResult,
};
