# Latent-K

Auto-sync context for AI coding assistants (Claude Code, Gemini CLI).

## What is Latent-K?

Latent-K is a CLI tool that automatically provides relevant code context to AI coding assistants. Instead of manually copying files or waiting for the AI to explore your codebase, Latent-K maintains a synchronized understanding of your project and injects the right context at the right time.

### The Problem

When working with AI coding assistants, you often face:
- **Repeated file exploration**: The AI needs to read files to understand your codebase
- **Token waste**: Large portions of context are spent on navigation rather than problem-solving
- **Slow first responses**: Initial questions require multiple file reads before getting useful answers

### The Solution

Latent-K solves this by mapping your codebase structure and file relationships. When you run `lk sync`, it analyzes your project and builds a map of how files connect to each other. This context is then automatically injected when you start a coding session, so the AI already understands your project structure before you ask anything.

Key capabilities:
- **File relations**: Maps how files in your project connect to each other
- **Automatic context injection**: Injects project structure at session start via hooks
- **MCP tools**: Claude Code gets tools to read files with context and query project structure
- **Better control over generated code**: When the AI understands your project structure and dependencies between files, it makes more accurate decisions — it knows where to place new code, which modules to import, and how changes ripple through your codebase

## Features

- **Automatic context injection** at session start via hooks
- **File relations** tracking connections between files
- **MCP Server** with tools for reading files and exploring the codebase
- **Git-aware sessions**: Includes recent changes, current branch, and pending work
- Multi-CLI support (Claude Code, Gemini CLI)

## Requirements

- **Operating System**: Linux, macOS, or Windows (x64)
- **Supported CLIs**: Claude Code and/or Gemini CLI installed
- **Git**: Recommended for full context awareness

## Installation

### One-liner (Linux/macOS)

```bash
curl -fsSL https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/lk-linux -o lk && chmod +x lk && sudo mv lk /usr/local/bin/
```

For macOS, replace `lk-linux` with `lk-macos`.

### Windows (PowerShell)

```powershell
irm https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/lk-win.exe -OutFile lk.exe; Move-Item lk.exe $env:LOCALAPPDATA\lk.exe
```

Binary is installed to `/usr/local/bin/lk` (Linux/macOS) or `%LOCALAPPDATA%\lk.exe` (Windows).

## Quick Start

```bash
lk activate   # Enter license key (get free trial at latentk.org) - hooks enabled automatically
claude        # Start coding - context is injected automatically
```

On your first session, ask Claude to sync the project:
```
> Sync project context
```

This creates the `.lk/` directory that powers all context features. LK will automatically detect outdated relations and prompt for a sync when needed.


## Commands

| Command | Description |
|---------|-------------|
| `lk activate` | Activate license |
| `lk sync` | Sync project context |
| `lk sync --all` | Full rebuild |
| `lk status` | Show project status |
| `lk enable` | Enable hooks (both CLIs) |
| `lk enable -t claude` | Enable for Claude Code only |
| `lk enable -t gemini` | Enable for Gemini CLI only |
| `lk disable` | Disable hooks |
| `lk mcp` | Show MCP status |
| `lk mcp on` | Enable MCP server for Claude Code |
| `lk mcp off` | Disable MCP server |
| `lk ignore` | Show ignore patterns summary |
| `lk ignore -l` | List all ignored files |

| `lk dead-code` | Find orphan files and unused exports |
| `lk pro-tips` | Show all LK pro tips |
| `lk update` | Update to latest version |
| `lk clean` | Remove lk data (context, license) |

## MCP Integration (Claude Code)

Latent-K provides an MCP server with tools that Claude Code can use automatically. MCP is enabled automatically when you run `lk activate`.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_project_context` | Get relevant file paths and project structure overview |
| `read_file` | Read file content with dependency context (see below) |
| `relation` | Add notes, relations, or review maintenance tasks |
| `invariant` | Manage business rules (add, remove, list, discover) |

### `read_file` — Context-Aware File Reading

The `read_file` tool is central to how Latent-K improves AI code generation. Instead of reading raw file content, it combines the file with project context so the AI understands how each file fits into the bigger picture.

When you read a file, the output includes:
- **Exports**: Public functions and classes the file exposes
- **Imported by**: Which files depend on this file
- **Imports**: Which files this file depends on
- **Notes**: Semantic annotations about the file's purpose and gotchas
- **`//usedby:` annotations**: Each exported function shows which files call it

Example output:
```
=== src/lib/db.js (120 lines) ===
Exports: query, connect, disconnect
Imported by: api/users.js, api/orders.js, services/auth.js
Imports: config.js
Notes: Database connection pool with automatic reconnect.

query(sql, params): 34-58 //usedby:users.js,orders.js,auth.js
connect(): 12-25 //usedby:server.js
```

This means the AI knows — before writing a single line — who calls each function and what would break if it changed. Large files (200+ lines) automatically show a skeleton view with function signatures and line ranges, so the AI can request specific sections with `offset`/`limit` instead of reading the entire file.

## Invariants

Invariants are business rules that span multiple files. They capture cross-file contracts that can't be enforced by imports alone — things like "the API response schema must match the frontend parser" or "all event handlers must call `trackAnalytics` before returning."

When you read a file with `read_file`, any invariants attached to it are shown at the top of the output. The AI must ask for user approval before making changes that would violate an invariant.

### When to use invariants

- **API contracts**: Request/response schemas shared between client and server
- **Shared formats**: File formats, serialization protocols, or data structures used across boundaries
- **Cross-boundary rules**: Conventions that span modules (e.g., "every new route must be registered in the router and the OpenAPI spec")

### When NOT to use invariants

- **Single-file rules**: Just use code comments instead
- **Design flaws**: If a rule exists because of poor coupling, fix the architecture instead

### CLI usage

```bash
lk invariant add "rule text" file1.js file2.js   # Add a rule spanning files
lk invariant remove <id>                          # Remove a rule by ID
lk invariant list                                 # List all rules
lk invariant list src/api.js                      # List rules for a specific file
```

### MCP usage

The `invariant` MCP tool supports a `discover` action that analyzes your codebase and suggests invariants you might want to add. Use it periodically to find implicit contracts between files.

## Language Support

Latent-K supports multiple programming languages with varying levels of feature support:

| Feature | JS/TS | Python | Go | Rust | Java/Kotlin | PHP | Ruby | C# | C/C++ |
|---------|:-----:|:------:|:--:|:----:|:-----------:|:---:|:----:|:--:|:-----:|
| **Extensions** | js, mjs, cjs, ts, tsx, jsx | py | go | rs | java, kt, kts | php | rb | cs | c, cpp, h, hpp |
| **Extract Imports** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Extract Exports** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Extract Skeleton** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Extract Signatures** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Extract Function Body** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Strip Comments** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |


## Ignore Patterns

Latent-K respects your project's `.gitignore` file. Any file matching a gitignore pattern will be excluded from context.

```bash
lk ignore        # Show summary of patterns
lk ignore -l     # List all ignored files
```

## Supported CLIs

| CLI | Status |
|-----|--------|
| Claude Code | Fully Supported |
| Gemini CLI | Fully Supported |

## Troubleshooting

### "License not activated" error

Run `lk activate` and enter your license key. If you don't have one, get a free trial at [latentk.org](https://www.latentk.org).

### Context not being injected

1. Make sure hooks are enabled: `lk enable`
2. Check that you've synced at least once: `lk sync`
3. Verify the project has a `.lk` directory

### Sync is slow on first run

The first sync analyzes all files in your project. Subsequent syncs are incremental and much faster.

### MCP tools not available in Claude Code

If Claude Code doesn't have access to the Latent-K tools (`read_file`, `get_project_context`, etc.), enable the MCP server:
```bash
lk mcp on
```

### Hooks not working after CLI update

If you update Claude Code or Gemini CLI, re-enable hooks:
```bash
lk disable
lk enable
```

## Support

For questions or issues, contact us at [info@latentk.org](mailto:info@latentk.org).

## License

Commercial software - license required. Free 14-day trial available.
