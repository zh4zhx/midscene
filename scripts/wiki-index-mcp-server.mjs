#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_WIKI_REPO = '/Users/test/Documents/auto-platform';
const DEFAULT_SKILL_RELATIVE_DIR = '.codex/skills/wiki-index-query';
const DEFAULT_TOP_K = 2;
const DEFAULT_TIMEOUT_MS = 5000;

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

function splitScopeEnv(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseArgs(argv) {
  const wikiRepo = stripTrailingSlash(
    process.env.WIKI_INDEX_MCP_WIKI_REPO || DEFAULT_WIKI_REPO,
  );
  const skillDir = stripTrailingSlash(
    process.env.WIKI_INDEX_MCP_SKILL_DIR ||
      pathJoin(wikiRepo, DEFAULT_SKILL_RELATIVE_DIR),
  );
  const options = {
    wikiRepo,
    skillDir,
    queryScript:
      process.env.WIKI_INDEX_MCP_QUERY_SCRIPT ||
      pathJoin(skillDir, 'query_wiki_index.py'),
    queryCwd: process.env.WIKI_INDEX_MCP_QUERY_CWD || wikiRepo,
    topK: Number(process.env.WIKI_INDEX_MCP_TOP_K || DEFAULT_TOP_K),
    timeoutMs: Number(
      process.env.WIKI_INDEX_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    ),
    scopes: splitScopeEnv(process.env.WIKI_INDEX_MCP_SCOPE),
  };

  const valueRequiredOptions = new Set([
    'wiki-repo',
    'skill-dir',
    'query-script',
    'query-cwd',
    'top-k',
    'timeout-ms',
    'scope',
  ]);

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

    if (key === 'wiki-repo') {
      options.wikiRepo = stripTrailingSlash(value);
      if (!process.env.WIKI_INDEX_MCP_QUERY_CWD) {
        options.queryCwd = options.wikiRepo;
      }
      if (
        !process.env.WIKI_INDEX_MCP_SKILL_DIR &&
        !process.env.WIKI_INDEX_MCP_QUERY_SCRIPT
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
      if (!process.env.WIKI_INDEX_MCP_QUERY_SCRIPT) {
        options.queryScript = pathJoin(options.skillDir, 'query_wiki_index.py');
      }
    }
    if (key === 'query-script') options.queryScript = value;
    if (key === 'query-cwd') options.queryCwd = value;
    if (key === 'top-k') options.topK = Number(value);
    if (key === 'timeout-ms') options.timeoutMs = Number(value);
    if (key === 'scope') options.scopes.push(value);
  }

  return {
    ...options,
    topK: normalizePositiveInteger(options.topK, DEFAULT_TOP_K),
    timeoutMs: normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
  };
}

function writeJsonRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeJsonRpc({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeError(id, code, message, data) {
  writeJsonRpc({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function getToolDefinition() {
  return {
    name: 'query_wiki_index',
    description:
      'Query the local PixCake wiki index. The caller must provide natural wiki search queries; this tool does not split, expand, or hardcode business terms.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query produced by the caller.',
        },
        topK: {
          type: 'number',
          description: 'Maximum number of matches to return.',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional scope filters.',
        },
        view: {
          type: 'string',
          enum: ['both', 'complete', 'evidence'],
          description: 'Result view.',
        },
        compact: {
          type: 'boolean',
          description: 'Return compact agent-friendly payload.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };
}

async function queryWikiIndex(args, options) {
  const query = String(args?.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const topK = normalizePositiveInteger(Number(args?.topK), options.topK);
  const view = ['both', 'complete', 'evidence'].includes(args?.view)
    ? args.view
    : 'both';
  const compact = args?.compact !== false;
  const scopes = Array.isArray(args?.scopes)
    ? args.scopes.map(String).filter(Boolean)
    : options.scopes;

  const cliArgs = [
    options.queryScript,
    query,
    '--view',
    view,
    '--json',
    '--top-k',
    String(topK),
  ];
  if (compact) cliArgs.push('--compact');
  for (const scope of scopes) cliArgs.push('--scope', scope);

  const { stdout } = await execFileAsync('python3', cliArgs, {
    cwd: options.queryCwd,
    timeout: options.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });

  JSON.parse(stdout);
  return stdout.trim();
}

async function handleRequest(message, options) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params } = message;

  try {
    if (method === 'initialize') {
      writeResult(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'wiki-index-mcp-server',
          version: '0.1.0',
        },
      });
      return;
    }

    if (method === 'notifications/initialized') return;

    if (method === 'tools/list') {
      writeResult(id, {
        tools: [getToolDefinition()],
      });
      return;
    }

    if (method === 'tools/call') {
      if (params?.name !== 'query_wiki_index') {
        writeError(id, -32602, `Unknown tool: ${params?.name || ''}`);
        return;
      }

      const text = await queryWikiIndex(params.arguments || {}, options);
      writeResult(id, {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      });
      return;
    }

    if (id !== undefined) {
      writeError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    writeResult(id, {
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    });
  }
}

function startServer(options) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const lineEnd = buffer.indexOf('\n');
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        writeError(null, -32700, 'Parse error', {
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      handleRequest(message, options);
    }
  });
}

const options = parseArgs(process.argv.slice(2));
startServer(options);

export {
  getToolDefinition,
  handleRequest,
  parseArgs,
  queryWikiIndex,
  startServer,
};
