# BabyTracker build targets.
#
# `make build` produces ./babytracker, a self-contained binary with the
# React frontend embedded. The Dockerfile mirrors these steps for the HA
# add-on / container builds.

VERSION := $(shell awk -F'"' '/^version:/{print $$2}' config.yaml)
BINARY  := babytracker
PKG     := github.com/mbentancour/babytracker
LDFLAGS := -s -w -X '$(PKG)/internal/version.Version=$(VERSION)'
STATIC  := internal/router/static

.PHONY: all build frontend backend test clean run docker version help

all: build

help: ## List targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: frontend backend ## Full build (frontend + backend)

frontend: ## Install frontend deps, build dist, sync into the Go embed dir
	cd frontend && npm install && npm run build
	find $(STATIC) -mindepth 1 ! -name '.gitkeep' -delete
	cp -r frontend/dist/. $(STATIC)/

backend: ## Build the Go binary (expects $(STATIC) already populated)
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BINARY) ./cmd/babytracker

test: ## Run Go tests
	go test ./...

clean: ## Remove build artifacts
	rm -f $(BINARY)
	rm -rf frontend/dist
	find $(STATIC) -mindepth 1 ! -name '.gitkeep' -delete

run: build ## Build then run the binary (assumes a reachable Postgres)
	./$(BINARY)

docker: ## Build + run via docker compose (root compose.yml)
	docker compose up --build

version: ## Print version from config.yaml
	@echo $(VERSION)
