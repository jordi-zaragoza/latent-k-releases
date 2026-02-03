# latent-k Plugin for Claude Code

Auto-sync project context with a persistent knowledge graph. Tracks file relationships, exports, and semantic notes across sessions.

## Prerequisites

This plugin requires the `lk` binary to be installed and activated.

### 1. Install the binary

```bash
curl -fsSL https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/install.sh | bash
```

### 2. Activate your license

```bash
lk activate
```

Get a license at [latentk.org](https://www.latentk.org/activation)

### 3. Initialize your project

```bash
cd your-project
lk sync
```

## Install the Plugin

### Option A: Add the marketplace

```
/plugin marketplace add jordi-zaragoza/latent-k-releases
/plugin install latent-k@jordi-zaragoza-latent-k-releases
```

### Option B: Direct installation (if marketplace is configured)

```
/plugin install latent-k
```

## What the Plugin Does

- **MCP Server**: Provides `get_project_context`, `read_file`, `update_edge`, and `review` tools
- **SessionStart hook**: Shows project context summary
- **UserPromptSubmit hook**: Injects relevant context before each prompt
- **Stop hook**: Syncs changes to the knowledge graph

## Tools Available

| Tool | Description |
|------|-------------|
| `get_project_context` | Quick overview of project structure and important files |
| `read_file` | Read files with import/export relationships |
| `update_edge` | Add notes or relations between files |
| `review` | Get next file needing documentation |

## More Info

- Website: https://www.latentk.org
- Releases: https://github.com/jordi-zaragoza/latent-k-releases
