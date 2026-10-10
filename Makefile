# Developer shortcuts. Everything runs through pnpm/turbo; see AGENTS.md → Commands.
.PHONY: dev api worker portal

# API (http://localhost:3000) + worker (Git sync) rebuild and restart on change; portal on http://localhost:5173.
dev:
	pnpm dev

api:
	pnpm --filter @kintsugi/api... dev

worker:
	pnpm --filter @kintsugi/orchestrator... dev

portal:
	pnpm --filter @kintsugi/portal dev
