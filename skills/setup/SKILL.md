---
name: setup
description: Help user install and configure latent-k. Use when user asks about latent-k installation, activation, or license.
---

# latent-k Setup Guide

When the user needs help with latent-k installation or configuration:

## Check if installed

Run: `which lk` or `lk --version`

## Installation (if not installed)

```bash
curl -fsSL https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/install.sh | bash
```

## Activation (after installation)

```bash
lk activate
```

This will prompt for a license key. Get one at: https://www.latentk.org/activation

## Initialize project

In the project directory:

```bash
lk sync
```

This creates the `.lk/` directory with the knowledge graph.

## Verify setup

```bash
lk status
```

## Common issues

- **"License required"**: Run `lk activate` with a valid license key
- **"No .lk context"**: Run `lk sync` in the project root
- **Command not found**: The binary isn't in PATH, try `/usr/local/bin/lk`
