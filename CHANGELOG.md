# Changelog

## 0.6.1

- Kept routine status and capability responses compact, with full assembly and skill inventories available on request.
- Standardized operation state, structured data and typed invocation values across CLI and MCP responses.
- Updated skills to prefer project configuration and skills, prepare code in isolated worktrees before Editor integration, and check the game state that actually consumes a setting.

## 0.6.0

- Added a local stdio MCP server and a project installer for Codex, Claude Code and Cursor, including configuration checks, conflict handling and undo.
- Added protocol 2 operation records, queued cancellation, FIFO Editor leases and ownership through active Play/profiler cleanup.
- Added source refresh receipts tied to file hashes, compilation and loaded assemblies. Checks can require a receipt and treat a false assertion as failure.
- Added bounded Play sessions with project C# callbacks, scene/time-scale restoration, background execution and optional Game-view PNG capture.
- Added CPU profiler capture and archive queries, caller/thread analysis, tick bookmarks and scenario context. Comparisons report differences in workload, focus and capture settings instead of presenting unmatched runs as regressions.
- Updated verification, operation and parallel-work skills and public setup documentation.

Native verification covers Windows with Unity 6000.5.5f1, including unfocused refresh, Play, screenshot capture and cleanup after reload. Other platforms have not received equivalent native Editor verification. See [operation evidence](docs/operations-verification.md) and [profiler evidence](docs/profiler-verification.md) for scope and limits.
