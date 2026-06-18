# Wiki Midscene Adapter 中转服务处理说明

`scripts/wiki-midscene-adapter.mjs` 是一个放在 Midscene 和视觉模型之间的 OpenAI-compatible 中转服务。它保留 Midscene 原有的 planning / locate / action 流程，但会在规划前补充知识库信息，并且可以用 MacDOM 快速读取当前 PixCake 界面 DOM 和坐标。

这个服务不直接点击、不输入、不滚动。MacDOM 在这里只负责“读当前界面”和“给坐标”；真正的动作仍由 Midscene 原 Action Space 执行，并进入 Midscene report。

## 核心职责

- 代理 OpenAI-compatible 请求到目标模型服务。
- 可选覆盖请求里的 `model`。
- 识别 Midscene planning 请求，并注入高优先级知识。
- 支持两种知识来源：
  - Claude CLI 调用已配置的 kbgraph MCP UI 工具。
  - 本地 wiki index 或 wiki MCP 工具。
- 识别 Midscene locate 请求，并在 MacDOM 命中时直接返回 locate bbox。
- 在 planning 阶段使用“当前 MacDOM 可见树 + 模型判断”定位当前下一步可操作控件，并把 bbox 注入给规划模型。
- 输出日志来判断知识查询、MacDOM 命中、下游模型采纳 bbox 是否真的发生。

## 推荐启动命令

当前推荐的 Claude/kbgraph + MacDOM planning 链路：

```bash
node scripts/wiki-midscene-adapter.mjs \
  --target http://10.232.21.20:7000/v1 \
  --model /root/hb/Qwen3-VL-8B-Instruct \
  --knowledge-provider claude \
  --claude-command /Users/test/.local/bin/claude \
  --claude-cwd /Users/test/Documents/auto-platform \
  --macdom-locate \
  --macdom-mode builtin \
  --macdom-base-url http://localhost:3511 \
  --macdom-candidate-model /root/hb/Qwen3-VL-8B-Instruct \
  --log-knowledge
```

如果目标模型在 Ollama / 本地 OpenAI-compatible 服务上，只替换 `--target` 和 `--model`：

```bash
node scripts/wiki-midscene-adapter.mjs \
  --target http://127.0.0.1:11434/v1 \
  --model qwen3-vl:8b-instruct-q4_K_M \
  --knowledge-provider claude \
  --claude-command /Users/test/.local/bin/claude \
  --claude-cwd /Users/test/Documents/auto-platform \
  --macdom-locate \
  --macdom-mode builtin \
  --macdom-base-url http://localhost:3511 \
  --macdom-candidate-model qwen3-vl:8b-instruct-q4_K_M \
  --log-knowledge
```

## 启动参数

### 代理基础参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--host` | `WIKI_MIDSCENE_HOST` | `127.0.0.1` | 监听 host。 |
| `--port` | `WIKI_MIDSCENE_PORT` | `18081` | 监听端口。 |
| `--target` | `WIKI_MIDSCENE_TARGET` | `http://127.0.0.1:18080/v1` | 目标 OpenAI-compatible 模型服务。 |
| `--model` | `WIKI_MIDSCENE_MODEL` | 空 | 如果设置，会覆盖所有转发请求体里的 `model`。 |
| `--timeout-ms` | `WIKI_MIDSCENE_TIMEOUT_MS` | `5000` | 辅助模型调用和 MCP 调用超时；更具体的 timeout 会覆盖它。 |
| `--disabled` | `WIKI_MIDSCENE_ENABLED=0` | enabled | 禁用知识注入；代理仍然工作。 |
| `--log-requests` / `--quiet` | `WIKI_MIDSCENE_LOG_REQUESTS` | enabled | 控制中转请求日志。 |
| `--log-knowledge` | `WIKI_MIDSCENE_LOG_KNOWLEDGE` | disabled | 打印完整知识内容，而不是 preview。 |
| `--log-knowledge-chars` | `WIKI_MIDSCENE_LOG_KNOWLEDGE_CHARS` | `1200` | preview 模式下的知识日志长度。 |

路径转发规则：`/v1/chat/completions` 会转到 `${target}/chat/completions`。其它 `/v1/...` 路径也会去掉 `/v1` 前缀后转发。

### 知识库参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--knowledge-provider` | `WIKI_MIDSCENE_KNOWLEDGE_PROVIDER` | `wiki`；如果 `WIKI_MIDSCENE_USE_CLAUDE=1` 则为 `claude` | 选择 `wiki` 或 `claude`。 |
| `--max-knowledge-chars` | `WIKI_MIDSCENE_MAX_KNOWLEDGE_CHARS` | `7000` | 最终注入知识的最大长度。 |
| `--query-term-model` | `WIKI_MIDSCENE_QUERY_TERM_MODEL` | 如果设置了转发模型则使用转发模型 | wiki 模式下生成检索词的模型。 |
| `--query-model-max-tokens` | `WIKI_MIDSCENE_QUERY_MODEL_MAX_TOKENS` | `192` | 辅助模型调用 token 上限。 |

### Claude 知识查询参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--claude-command` | `WIKI_MIDSCENE_CLAUDE_COMMAND` | 依次查找 `~/.local/bin/claude`、Homebrew 路径，最后为 `claude` | Claude CLI 可执行文件。 |
| `--claude-shell` | `WIKI_MIDSCENE_CLAUDE_SHELL=1` | disabled | 通过用户 shell 执行 Claude。一般建议直接传绝对路径。 |
| `--claude-cwd` | `WIKI_MIDSCENE_CLAUDE_CWD` | `--wiki-repo` 或默认 wiki repo | Claude 工作目录。Claude 的 MCP 配置通常跟 cwd 相关。 |
| `--claude-mcp-config` | `WIKI_MIDSCENE_CLAUDE_MCP_CONFIG` | 空 | 可选，显式传给 Claude 的 MCP config。为空时由 Claude 自己按 cwd 找配置。 |
| `--claude-model` | `WIKI_MIDSCENE_CLAUDE_MODEL` | 空 | 可选 Claude model。 |
| `--claude-output-format` | `WIKI_MIDSCENE_CLAUDE_OUTPUT_FORMAT` | `stream-json` | Claude 输出格式。 |
| `--claude-timeout-ms` | `WIKI_MIDSCENE_CLAUDE_TIMEOUT_MS` | `300000` | Claude 查询超时。 |
| `--claude-cache-mode` | `WIKI_MIDSCENE_CLAUDE_CACHE_MODE` | `instruction` | `instruction`、`once` 或 `off`。 |
| `--claude-arg` / `--claude-args` | `WIKI_MIDSCENE_CLAUDE_ARGS` | 空 | 额外 Claude 参数。 |
| `--claude-skip-permissions=false` | `WIKI_MIDSCENE_CLAUDE_SKIP_PERMISSIONS=0` | 默认会带 `--dangerously-skip-permissions` | 是否跳过 Claude 权限确认。 |

当前 Claude prompt 会尽量贴近手动查询：

```text
使用kbgraph mcp UI工具查询如何<用户指令>
只输出简短中文操作信息。必须包含操作步骤、控件路径、控件名、objectName、text/controlType/abilities；如果第一次结果缺少 objectName，请继续用 kbgraph UI 工具查询补齐。不要修改文件，不要执行项目命令。
```

`--claude-cwd` 很关键。如果 kbgraph MCP 已经配置在 `/Users/test/Documents/auto-platform`，就设置：

```bash
--claude-cwd /Users/test/Documents/auto-platform
```

这种情况下通常不需要再传 `--claude-mcp-config`。

### Wiki CLI / Wiki MCP 参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--wiki-repo` | `WIKI_MIDSCENE_WIKI_REPO` | `/Users/test/Documents/auto-platform` | wiki index skill 所在仓库。也会作为默认 `claude-cwd`、`query-cwd`、`macdom-repo`。 |
| `--skill-dir` | `WIKI_MIDSCENE_SKILL_DIR` | `<wiki-repo>/.codex/skills/wiki-index-query` | 本地 wiki skill 目录。 |
| `--query-script` | `WIKI_MIDSCENE_QUERY_SCRIPT` | `<skill-dir>/query_wiki_index.py` | Python wiki 查询脚本。 |
| `--query-cwd` | `WIKI_MIDSCENE_QUERY_CWD` | `--wiki-repo` | Python wiki 查询 cwd。 |
| `--top-k` | `WIKI_MIDSCENE_TOP_K` | `2` | 每个 query 的 top K。 |
| `--query-limit` | `WIKI_MIDSCENE_QUERY_LIMIT` | `4` | 模型生成检索词的最多数量。 |
| `--scope` | `WIKI_MIDSCENE_SCOPE` | 空 | wiki scope 过滤；环境变量用 `|` 分隔多个 scope。 |
| `--wiki-mcp` | `WIKI_MIDSCENE_USE_MCP=1` | 只有配置 MCP URL 时默认开启 | 启用 MCP 查询。 |
| `--wiki-mcp-config` | `WIKI_MIDSCENE_MCP_CONFIG` | 空 | 读取 MCP config JSON。 |
| `--wiki-mcp-server` | `WIKI_MIDSCENE_MCP_SERVER` | 优先 `kbgraph`，否则第一个 server | MCP config 里的 server key。 |
| `--wiki-mcp-url` | `WIKI_MIDSCENE_MCP_URL` | 空 | HTTP MCP JSON-RPC 地址。 |
| `--wiki-mcp-header` | `WIKI_MIDSCENE_MCP_HEADERS` | 空 | MCP header，支持 JSON 或 `k=v|k2=v2`。 |
| `WIKI_MIDSCENE_MCP_AUTHORIZATION` | 同名环境变量 | 空 | 便捷 authorization header。 |
| `--wiki-mcp-tool` | `WIKI_MIDSCENE_MCP_TOOL` | HTTP 下自动选择；stdio 下默认 `query_wiki_index` | MCP tool 名。 |
| `--wiki-mcp-repo-id` | `WIKI_MIDSCENE_MCP_REPO_ID` | 空 | 调 tool 时补 `repo_id` / `repoId`。 |

MCP config 支持字段：`type`、`url`、`command`、`args`、`cwd`、`headers`、`tool`、`repo_id`、`repoId`。

### MacDOM 参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--macdom-locate` | `WIKI_MIDSCENE_MACDOM_LOCATE=1` 或 `WIKI_MIDSCENE_USE_MACDOM=1` | disabled | 启用 MacDOM planning 和 locate 能力。 |
| `--macdom-mode` | `WIKI_MIDSCENE_MACDOM_MODE` | `builtin` | `builtin` 直接读 CHUIServer `/api/get_visible_tree`；`python` 使用 MacDOM skill dispatcher。 |
| `--macdom-base-url` | `WIKI_MIDSCENE_MACDOM_BASE_URL` | `http://localhost:3511` | CHUIServer 地址。 |
| `--macdom-repo` | `WIKI_MIDSCENE_MACDOM_REPO` | `--wiki-repo` | 仅 `python` 模式需要，指向包含 `.agents/skills/macdom` 的 repo。 |
| `--macdom-timeout-ms` | `WIKI_MIDSCENE_MACDOM_TIMEOUT_MS` | `3000` | MacDOM 查询超时。 |
| `--macdom-debug` | `WIKI_MIDSCENE_MACDOM_DEBUG=1` | disabled | 打印 visible-tree 候选、miss 细节。 |
| `--macdom-screen-size` | `WIKI_MIDSCENE_MACDOM_SCREEN_SIZE` | macOS 自动检测；否则用截图尺寸 | MacDOM bounds 所在逻辑屏幕尺寸，如 `1512x982`。 |
| `--macdom-candidate-model` | `WIKI_MIDSCENE_MACDOM_CANDIDATE_MODEL` | query-term model、转发 model 或默认模型 | 用于 current-step 判断和 locate candidate 生成。 |
| `--no-macdom-candidate-model` | `WIKI_MIDSCENE_MACDOM_CANDIDATE_MODEL_ENABLED=0` | enabled | 禁用模型辅助 MacDOM 判断。 |
| `--macdom-candidate-limit` | `WIKI_MIDSCENE_MACDOM_CANDIDATE_LIMIT` | `8` | locate 阶段模型候选数量。 |

## 请求处理总流程

### 非 chat completion 请求

不是 `POST /v1/chat/completions` 或 `POST /chat/completions` 的请求会直接代理到目标服务，只做路径重写和响应头透传。

### Chat completion 请求

chat completion 会按顺序处理：

1. 读取 JSON body。
2. 如果配置了 `--model`，覆盖 body 里的 `model`。
3. 判断是否是 Midscene planning 请求。
4. 打印请求日志：

```text
[wiki-midscene-adapter] #1 chat request {"planning":true,"locate":false,"model":"...","originalModel":"...","modelOverridden":true}
```

5. 如果是 planning，请执行 planning enrichment。
6. 如果是 locate，请尝试 MacDOM locate 短路。
7. 如果没有短路响应，转发到 `--target`。
8. 如果是 planning，检查下游模型是否使用了注入的 MacDOM bbox。

## 请求分类

### Planning 请求识别

满足以下条件会被认为是 planning：

- 请求里有图片。
- 文本里包含任一关键词：
  - `<action-type`
  - `<action-param-json`
  - `Determine Next Action`
  - `No previous actions have been executed`

用户指令优先从 `<user_instruction>...</user_instruction>` 提取。没有这个 tag 时，会退回到非 system 文本消息，并跳过明显的 screenshot/history 文案。

### Locate 请求识别

满足以下条件会被认为是 locate：

- 请求里有图片。
- 不是 planning。
- 文本像坐标定位任务，例如：
  - `"bbox"` 或 `` `bbox` ``
  - `"point"` 或 `` `point` ``
  - `Output Format:` 中包含 bbox / point
  - `Find: ...`
  - `Find section containing: ...`
  - `Identify elements in screenshots`
  - `Provide the coordinates of the element`

locate prompt 当前从 `Find:` 或 `Find section containing:` 提取。

## Planning Enrichment 流程

planning 请求会按以下步骤增强：

1. 提取 Midscene 用户指令。
2. 用选定 provider 查询知识。
3. 写入 `latestPlanningContext`：
   - `instruction`
   - `terms`
   - `knowledge`
   - 从知识里抽取的 MacDOM locator candidates
4. 如果启用了 MacDOM，执行 MacDOM planning 坐标查询。
5. 合并知识库内容和 MacDOM 坐标内容。
6. 注入到 `<high_priority_knowledge>...</high_priority_knowledge>`，位置在 `<user_instruction>` 前面。

注入内容会提醒规划模型：

- 知识库只是辅助上下文。
- 如果目标控件当前不可见，应按路径导航，不要直接判定任务不可满足。
- 当前截图和执行历史仍是最终事实来源。

## Claude / kbgraph 知识查询

当 `--knowledge-provider claude` 时：

1. 构造“使用 kbgraph mcp UI 工具查询如何...”的 prompt。
2. 用 `--claude-command`、`--claude-cwd`、可选 `--claude-mcp-config` 执行 Claude CLI。
3. 解析 Claude 输出：
   - 单个 JSON 对象。
   - `stream-json` 多行 JSON。
   - 普通文本 fallback。
4. 空输出或 `NO_RELEVANT_KNOWLEDGE` 不注入。
5. 默认按 instruction 缓存。
6. 成功输出会套上规划提示后注入。

关键日志：

```text
claude knowledge query
claude knowledge result
claude knowledge content
claude knowledge cache hit
claude knowledge failed
```

## Wiki CLI / MCP 知识查询

当 `--knowledge-provider wiki` 时：

1. 先用配置的 query-term model 把用户指令改写成检索词。
2. 对每个检索词查询：
   - Python CLI：`python3 <query-script> <term> --view both --compact --json --top-k <topK>`
   - MCP：`tools/call`，参数包含 `query`、`q`、`keyword`、`text`、`topK`、`limit`、`scopes`、`view=both`、`compact=true`
3. 对结果做摘要，保留 path / locator / route / flow / notes。
4. 有摘要才注入 planning prompt。

MCP 支持：

- HTTP MCP：JSON-RPC over POST，支持普通 JSON 和 SSE 风格 `data:` 响应。
- Stdio MCP：启动 `--wiki-mcp-command` 和 `--wiki-mcp-args`。

HTTP MCP 没配置 tool 时，会自动列 tools，优先选 `wiki_search`，再选 `fusion_query`，再按知识/搜索相关性选其它工具。已知 tool 时建议直接传 `--wiki-mcp-tool wiki_search`。

## MacDOM Planning 流程

MacDOM planning 触发条件：

- 当前请求是 planning。
- 启用了 `--macdom-locate`。
- 请求图片是可解析尺寸的 PNG/JPEG data URL。

`builtin` 模式流程：

1. 请求 `GET <macdom-base-url>/api/get_visible_tree?compact=false`。
2. 解析 visible-tree XML，得到节点：
   - `id`
   - `tag`
   - `objectName`
   - `className`
   - `text`
   - `toolTip`
   - `special`
   - `visible`
   - `enabled`
   - `bounds`
3. 根据用户目标和知识内容给可见节点打分，默认截断到 160 个节点发给模型。
4. 调用 `--macdom-candidate-model` 做“当前界面下一步定位器”判断。
5. 模型必须从当前可见节点里选一个节点，返回 JSON：

```json
{
  "node_id": 125,
  "next_action": "点击眼睛增强分组下的手动涂抹局部工具入口",
  "locator": { "special": "眼睛增强" },
  "reason": "..."
}
```

6. 中转服务校验模型选择：
   - `node_id` 必须存在。
   - locator 必须是单字段。
   - 选中节点校验使用严格字段匹配：
     - `text` 只匹配节点真实 `text`。
     - `tool_tip` 只匹配节点真实 `toolTip`。
     - `special` 只匹配节点真实 `special`。
   - 点击/打开类任务会拒绝装饰节点，例如 label、icon label、SVG widget、frame、`HeaderState`、`HeaderTitle`、warning icon。
7. 如果第一轮模型选择被拒绝，会把拒绝原因喂回模型，重试一次。
8. 命中合法 bounds 后，把 MacDOM bounds 转成 qwen3-vl 的 `[0,1000]` bbox。
9. 把 MacDOM 命中信息注入给 planning 模型。

MacDOM planning 不点击，只注入类似内容：

```text
MacDOM 当前界面实时定位到以下控件坐标。
traceId: macdom-1
下一步: 点击眼睛增强分组下的手动涂抹局部工具入口
候选: special=眼睛增强
命中控件: objectName=TsSliderHeaderOperator, className=pixcakeTSRefineTabButton, toolTip=手动涂抹, special=眼睛增强
MacDOM match mode: visible-tree-model-current-step
bounds: x=1419, y=465, width=16, height=25
MacDOM bounds coordinate space: screen-logical (1512x982, detected)
qwen3-vl normalized bbox: [938, 474, 949, 499]
如果下一步操作目标就是该控件，可以直接在 action-param-json 的 locate 中使用这个 bbox；实际点击/输入/滚动仍由 Midscene 原 Action Space 执行。
```

### 示例：“打开眼睛增强手动涂抹”

成功时应该看到类似日志：

```text
claude knowledge content ... 眼睛增强 ... 分组局部工具入口 ... TsSliderHeaderOperator
macdom current-step visible tree ... node id 125 ... objectName TsSliderHeaderOperator ... toolTip 手动涂抹 ... special 眼睛增强
macdom current-step decision {"nodeId":125,...}
macdom planning hit ... "matchedProps":{"objectName":"TsSliderHeaderOperator","toolTip":"手动涂抹","special":"眼睛增强"...} ... "bbox":[938,474,949,499]
macdom planning usage check ... "used":true ... "matchedPayload":[938,474,949,499]
```

这表示中转服务已经定位到正确的手动涂抹入口，注入了 bbox，并且下游 planning 模型采纳了这个 bbox。

## MacDOM Locate 流程

MacDOM locate 和 MacDOM planning 是两条不同路径。

locate 请求处理：

1. 从 `Find:` 或 `Find section containing:` 提取 locate prompt。
2. 从请求图片读取 image size。
3. 构造候选：
   - 最近一次 planning knowledge 里提取到的候选。
   - locate prompt 文本候选。
   - 可选 candidate model 输出。
4. 查询 MacDOM：
   - `builtin` 模式搜索 visible tree。
   - `python` 模式执行 `<macdom-repo>/.agents/skills/macdom/scripts/macdom_dispatch.py get-props ...`。
5. 如果命中可见节点并且 bounds 合法，直接返回 OpenAI-compatible chat completion：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"bbox\":[xmin,ymin,xmax,ymax],\"errors\":[]}"
      }
    }
  ]
}
```

6. 如果 MacDOM miss、超时或 bounds 异常，则记录 fallback 并把原 locate 请求转发给视觉模型。

关键日志：

```text
macdom locate hit
macdom locate miss
macdom locate skipped
macdom locate fallback forwarded
```

## Candidate 规则

MacDOM candidate 设计为单字段。支持字段：

- `object_name`
- `xpath`
- `tool_tip`
- `text`
- `special`
- `class_name`

`controlType` / `控制类型` 不再作为 MacDOM locator。它只是描述信息。

这样做是为了避免 `{object_name, text}` 这种 AND 组合导致查不到，或在多个同名控件场景里误匹配。重复控件的消歧交给 planning 阶段的 current-step 模型通过 `node_id` 完成。

candidate 排序优先级：

1. `object_name`
2. `xpath`
3. `tool_tip`
4. `text`
5. `special`
6. `class_name`

## 坐标转换

MacDOM bounds 通常是 macOS logical screen 坐标，而 qwen3-vl bbox 需要请求截图坐标系下的 `[0,1000]` 归一化坐标。

坐标空间选择顺序：

1. 如果配置了 `--macdom-screen-size WIDTHxHEIGHT`，使用配置值。
2. macOS 下自动执行：

```applescript
tell application "Finder" to get bounds of window of desktop
```

3. 如果自动检测失败，认为 MacDOM bounds 已经和请求图片同坐标系。

转换步骤：

1. 如果是 screen-logical 坐标，先按屏幕尺寸映射到请求图片尺寸。
2. 转为 `[x1,y1,x2,y2]`。
3. 归一化到 `[0,1000]`，并 clamp / round。

示例：

```text
MacDOM bounds: x=1419, y=465, width=16, height=25
screen logical size: 1512x982
image size: 1512x982
normalized bbox: [938, 474, 949, 499]
```

## 缓存

所有缓存都是进程内缓存，重启即清空：

- `wikiCache`：最多 100 条 wiki query 结果。
- `claudeKnowledgeCache`：最多 100 条 instruction/config 维度 Claude 结果。
- `claudeOnceKnowledge`：`--claude-cache-mode once` 时保存一次全局结果。
- `macdomCandidateCache`：最多 100 条 locate candidate model 结果。
- `latestPlanningContext`：最近一次 planning 的 instruction / knowledge / candidates，供 locate 兜底使用。
- `latestMacdomPlanningHit`：最近一次 MacDOM planning 命中，用来检查下游模型是否采纳 bbox。

## 日志速查

通用：

```text
#1 incoming
#1 chat request
#1 forwarded
#1 proxied
```

知识查询：

```text
planning request enriched
planning request passed without wiki knowledge
planning injected knowledge
wiki query terms from model
wiki query terms
wiki query result
wiki query failed
wiki MCP client initialized
wiki MCP tool selected
wiki MCP tool response
claude knowledge query
claude knowledge result
claude knowledge content
claude knowledge cache hit
claude knowledge failed
```

MacDOM planning：

```text
macdom planning skipped
macdom current-step visible tree
macdom current-step decision
macdom current-step rejected
macdom current-step skipped
macdom current-step model failed
macdom planning hit
macdom planning miss
planning request enriched with macdom
macdom planning usage check
```

MacDOM locate：

```text
macdom locate skipped
macdom locate candidates
macdom locate hit
macdom locate miss
macdom locate fallback forwarded
```

## 失败和回退

- 知识查询失败：继续转发给目标模型。
- Claude 输出为空或 `NO_RELEVANT_KNOWLEDGE`：不注入知识。
- MacDOM planning 失败：planning 继续走，有知识则仍注入知识。
- MacDOM locate miss：原 locate 请求转发给视觉模型。
- CHUIServer 不可用：MacDOM 记录失败 / miss，不阻断普通转发。
- 中转自身异常：返回 HTTP 500 和错误信息。

## 当前测试覆盖

`scripts/wiki-midscene-adapter.test.mjs` 覆盖：

- Midscene locate 请求识别。
- 知识摘要提取 MacDOM candidate。
- candidate 保持单字段。
- `controlType` 不作为 locator。
- Claude prompt 形态。
- MacDOM bbox 归一化。
- logical screen 坐标映射。
- OpenAI-compatible assistant content 解析。
- planning 响应是否采纳 MacDOM bbox。
- MacDOM locate 命中短路。
- Python MacDOM mode。
- planning 请求注入 MacDOM 坐标。
- tooltip-backed 控件。
- 多个重复控件由 current-step 模型消歧。
- current-step 模型误选装饰节点时会被拒绝并重试。
- 关闭 current-step 模型时不强行消歧。
- MacDOM miss 时 locate 原样转发。

推荐聚焦验证命令：

```bash
node --check scripts/wiki-midscene-adapter.mjs
node --check scripts/wiki-midscene-adapter.test.mjs
node --test scripts/wiki-midscene-adapter.test.mjs
pnpm exec biome check scripts/wiki-midscene-adapter.mjs scripts/wiki-midscene-adapter.test.mjs
```

## 已知边界

- 这个中转不是 Midscene executor，只增强或短路模型请求。
- MacDOM 不执行操作，只读 DOM 和坐标。
- MacDOM planning 的最终节点选择依赖 `--macdom-candidate-model`。
- MacDOM locate 仍是 candidate 直查兜底，语义判断弱于 planning current-step。
- `builtin` MacDOM mode 依赖 CHUIServer visible-tree XML 里有可用 absolute bounds。
- `python` MacDOM mode 依赖外部 `.agents/skills/macdom` 脚本和 repo venv。
- 所有缓存都是进程内缓存，不持久化。
