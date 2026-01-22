# Latent-K

Auto-sync context for AI coding assistants (Claude Code, Gemini CLI).

## Features

- **Prompt expansion**: AI analyzes your prompt and injects relevant code context
- **Direct answers**: Simple questions get instant answers without file reads
- Automatic context injection at session start
- Auto-sync on session end
- Multi-CLI support (Claude Code, Gemini CLI)

## Installation

```bash
curl -fsSL https://github.com/jordi-zaragoza/latent-k-releases/releases/download/{{VERSION}}/install.sh | bash
```

Binary is installed to `/usr/local/bin/lk`.

## Quick Start

```bash
lk activate  # Enter license key
lk setup     # Configure AI provider
lk enable    # Enable hooks for Claude + Gemini
lk sync      # Initial sync
```

## Commands

| Command | Description |
|---------|-------------|
| `lk activate` | Activate license |
| `lk setup` | Configure AI provider |
| `lk sync` | Manual sync |
| `lk sync --all` | Sync all pending files |
| `lk status` | Show project status |
| `lk enable` | Enable hooks (both CLIs) |
| `lk enable -t claude` | Enable for Claude Code only |
| `lk enable -t gemini` | Enable for Gemini CLI only |
| `lk disable` | Disable hooks |
| `lk ignore <pattern>` | Add ignore pattern |
| `lk update` | Update to latest version |
| `lk clean` | Remove lk data |

## Ignore Patterns

```bash
# Add custom patterns
lk ignore "**/*.generated.js"
lk ignore "**/fixtures/**"
```

## Supported CLIs

| CLI | Status |
|-----|--------|
| Claude Code | Supported |
| Gemini CLI | Supported |

## Benchmarks

- [Small project benchmark (PDF)](benchmarks/benchmark_small.pdf) - 6,596 files, **1.38x faster**
- [Large project benchmark (PDF)](benchmarks/benchmark_big.pdf) - 27,985 files, **1.61x faster**

## License

Commercial software - license required.
