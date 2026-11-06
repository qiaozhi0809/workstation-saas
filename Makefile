.PHONY: dev dev-down backend web migrate seed reset-db test image bundle

VERSION ?= 0.0.0-dev

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

image:
	docker build -f deploy/docker/app.Dockerfile --build-arg WS_APP_VERSION=$(VERSION) -t workstation-app:$(VERSION) .
	docker build -f deploy/docker/web.Dockerfile -t workstation-web:$(VERSION) .
	docker build -f deploy/docker/stream.Dockerfile --build-arg APP_IMAGE=workstation-app:$(VERSION) -t workstation-stream:$(VERSION) .

# 离线部署包:make bundle VERSION=0.7.0(版本号必须是 1.2.3 / 1.2.3-rc.1 / 1.2.3-ci)
bundle:
	deploy/release/build-bundle.sh $(VERSION)
	deploy/tests/bundle_smoke.sh $(VERSION)
