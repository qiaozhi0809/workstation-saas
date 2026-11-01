.PHONY: dev dev-down backend web

dev:
	docker compose -f deploy/docker-compose.dev.yml up -d --wait

dev-down:
	docker compose -f deploy/docker-compose.dev.yml down

backend:
	cd server && uv run uvicorn --factory app.main:create_app --reload --port 8080

web:
	cd apps/web && npm run dev
