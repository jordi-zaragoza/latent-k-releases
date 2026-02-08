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

## Getting the Most Out of Latent-K

For each project, follow these steps to optimize your workflow.

1. **Initial sync**: Run `lk sync` in your project root. The output shows which files are synced and which are ignored. By default, only the most relevant files are synced to optimize token usage.

2. **Ignore patterns**: Latent-K respects your `.gitignore` file. Add patterns there to exclude files from context.

3. **Full sync**: Run `lk sync --all` for a full rebuild.

4. **Manage long conversations**: Use `/clear` when switching topics, or `/compact` to compress context in long sessions.

5. **Git-aware sessions**: Latent-K automatically includes context about recent changes, current branch, and pending work. Make sure you have `git` installed to get the most out of this feature.

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
| `read_file` | Read file content with relation context and `//usedby:` annotations |
| `update_relation` | Add notes or relations between files |
| `review` | Get next maintenance task: dead code, outdated relations, missing notes |

The MCP tools provide richer context than the built-in Read tool, showing file relationships and connections.

### Understanding Function Usage

When reading files, exported functions show who uses them via `//usedby:` comments:

```
getAllFiles(root): 45-67 //usedby:expand.js,sync.js,status.js
isIgnored(file, patterns): 92-108 //usedby:sync.js,status.js
```

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

### Feature Descriptions

- **Extract Imports**: Detects dependencies from import statements
- **Extract Exports**: Detects public functions/classes for the project overview
- **Extract Skeleton**: Condensed file view with signatures and line ranges
- **Extract Signatures**: Parses function parameters with types/defaults
- **Extract Function Body**: Extracts specific function code by name
- **Strip Comments**: Removes comments for cleaner parsing

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
