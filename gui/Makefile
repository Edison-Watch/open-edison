# Open Edison Desktop Makefile

.PHONY: help install build dev prod test clean dist

help: ## Show this help message
	@echo "Open Edison Desktop - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	npm install
	cd ../frontend && npm install

build: ## Build the TypeScript code
	npm run build

dev: ## Run in development mode
	npm run electron:dev

prod: ## Run in production mode
	npm run electron

test: ## Test the setup
	./test-setup.sh

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf node_modules/
	rm -rf ../frontend/node_modules/

dist: ## Create distribution packages
	npm run dist

setup: install build ## Complete setup (install + build)
	@echo "✅ Setup complete! Run 'make dev' to start development mode"
