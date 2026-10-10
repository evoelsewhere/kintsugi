# Developer shortcuts. Everything runs through pnpm/turbo; see AGENTS.md → Commands.
.PHONY: dev api portal

# API (http://localhost:3000, rebuilds and restarts on change) + portal (http://localhost:5173).
dev:
	pnpm dev

api:
	pnpm --filter @kintsugi/api... dev

portal:
	pnpm --filter @kintsugi/portal dev
