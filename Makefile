.PHONY: dev dev-down backend web migrate seed reset-db test

dev:
	docker compose -f deploy/docker-compose.dev.yml up -d --wait

dev-down:
	docker compose -f deploy/docker-compose.dev.yml down

backend:
	cd server && uv run uvicorn --factory app.main:create_app --reload --port 8080

web:
	cd apps/web && npm run dev

migrate:
	cd server && uv run alembic upgrade head

seed:
	cd server && uv run python -m app.cli seed-dev

reset-db:
	cd server && uv run alembic downgrade base && uv run alembic upgrade head && uv run python -m app.cli seed-dev

test:
	cd server && uv run pytest
	cd apps/web && npm run test
