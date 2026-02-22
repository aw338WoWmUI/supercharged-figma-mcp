# Security Policy

## Supported Scope

This repository contains:
- MCP server runtime (`src/`, `dist/`)
- Figma plugin bridge/runtime (`figma-plugin/`)
- Relay runtime for local/remote connectivity (`relay-server.js`, worker relay)

Security issues affecting any of the above are in scope.

## Reporting a Vulnerability

Please report security issues privately to the maintainer first. Do not open a public issue with exploit details before a fix is available.

Include:
- affected version/commit
- reproduction steps
- impact assessment
- suggested mitigation (optional)

## Sensitive Data Handling

The project should not store secrets in source control.

Rules:
- never commit API keys, tokens, or private keys
- use environment variables / platform secrets (for example `MCP_API_KEYS`)
- keep local `.env*` files untracked

## Release Hygiene

Before publishing:
- run validation (`npm run validate`)
- ensure no secrets are present in tracked files
- keep npm package content minimal (runtime-only artifacts)
