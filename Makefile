# Open Edison Makefile

########################################################
# Colors
########################################################
# ANSI color codes
GREEN=\033[0;32m
YELLOW=\033[0;33m
RED=\033[0;31m
BLUE=\033[0;34m
RESET=\033[0m

PYTHON=rye run python
TEST=rye run pytest
PROJECT_ROOT=.

.PHONY: help
help: ## Show this help message
	@echo "$(BLUE)Available targets:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(RESET) %s\n", $$1, $$2}'

# Default target
.PHONY: all
all: run ## Run the Open Edison MCP Proxy Server (default)

# Run the Open Edison MCP proxy server
.PHONY: run
run: check_rye ## Run the Open Edison MCP Proxy Server
	@echo "🚀 Starting Open Edison MCP Proxy Server..."
	rye run python main.py

# Run the server in development mode
.PHONY: dev
dev: ## Run the server in development mode
	@echo "🔧 Starting Open Edison in development mode..."
	rye run python main.py

########################################################
# Check dependencies
########################################################

check_rye: ## Check if rye is installed and show version
	@echo "$(YELLOW)🔍Checking rye version...$(RESET)"
	@if ! command -v rye > /dev/null 2>&1; then \
		echo "$(RED)rye is not installed. Please install rye before proceeding.$(RESET)"; \
		exit 1; \
	else \
		rye --version; \
	fi

########################################################
# Python dependency-related
########################################################

update_python_dep: check_rye ## Update and sync Python dependencies
	@echo "$(YELLOW)🔄Updating python dependencies...$(RESET)"
	@rye sync

sync: check_rye ## Sync Python dependencies
	@echo "$(YELLOW)🔄Syncing python dependencies...$(RESET)"
	@rye sync

########################################################
# Setup and initialization
########################################################

setup: check_rye sync ## Setup the project for development
	@echo "$(YELLOW)🔧 Setting up Open Edison for development...$(RESET)"
	@if [ ! -f config.json ]; then \
		echo "$(YELLOW)📝 Creating default config.json...$(RESET)"; \
		$(PYTHON) -c "from src.config import Config; Config.create_default().save()"; \
	fi
	@echo "$(GREEN)✅ Setup complete! Edit config.json to configure your MCP servers.$(RESET)"

########################################################
# Run Tests
########################################################

TEST_TARGETS = tests/

# Tests
.PHONY: test
test: check_rye ## Run all project tests
	@echo "$(GREEN)🧪Running tests...$(RESET)"
	$(TEST) $(TEST_TARGETS)
	@echo "$(GREEN)✅Tests passed.$(RESET)"

########################################################
# Linting and Code Quality
########################################################

lint: check_rye ## Lint code with Ruff
	@echo "$(YELLOW)🔍Linting project with Ruff...$(RESET)"
	@rye run ruff check .
	@echo "$(GREEN)✅Ruff linting completed.$(RESET)"

format: check_rye ## Format code with Ruff
	@echo "$(YELLOW)🎨Formatting code with Ruff...$(RESET)"
	@rye run ruff format .
	@echo "$(GREEN)✅Code formatting completed.$(RESET)"

fix: check_rye ## Auto-fix linting issues with Ruff
	@echo "$(YELLOW)🔧Fixing linting issues with Ruff...$(RESET)"
	@rye run ruff check . --fix
	@echo "$(GREEN)✅Linting fixes applied.$(RESET)"

basedpyright_check: check_rye ## Run type checking with Basedpyright
	@echo "$(YELLOW)🔍Running Basedpyright...$(RESET)"
	@rye run basedpyright .
	@echo "$(GREEN)✅Basedpyright completed.$(RESET)"

ci: lint basedpyright_check ## Run CI checks (lint, type check)
	@echo "$(GREEN)✅CI checks completed.$(RESET)"

########################################################
# Configuration Management
########################################################

config_create: check_rye ## Create a new default config.json
	@echo "$(YELLOW)📝Creating default config.json...$(RESET)"
	@$(PYTHON) -c "from src.config import Config; Config.create_default().save()"
	@echo "$(GREEN)✅Default config.json created. Edit it to configure your MCP servers.$(RESET)"

config_validate: check_rye ## Validate the current config.json
	@echo "$(YELLOW)🔍Validating config.json...$(RESET)"
	@$(PYTHON) -c "from src.config import config; print('✅ Configuration is valid')"
	@echo "$(GREEN)✅Configuration validation completed.$(RESET)"

########################################################
# Docker (optional)
########################################################

DOCKER_IMAGE_NAME = open-edison
DOCKER_IMAGE_TAG = $(shell git rev-parse --short HEAD)

docker_build: ## Build the Docker image
	@echo "$(YELLOW)🔍Building Docker image...$(RESET)"
	@docker build -t $(DOCKER_IMAGE_NAME) .
	@echo "$(GREEN)✅Docker image built.$(RESET)"

docker_run: docker_build ## Run the Docker image
	@echo "$(YELLOW)🔍Running Docker image...$(RESET)"
	@docker run -p 3000:3000 -p 3001:3001 -v $(PWD)/config.json:/app/config.json $(DOCKER_IMAGE_NAME)
	@echo "$(GREEN)✅Docker image running on port 3000 and 3001.$(RESET)"

########################################################
# Package for distribution
########################################################

build: check_rye ## Build the package
	@echo "$(YELLOW)📦Building package...$(RESET)"
	@rye build
	@echo "$(GREEN)✅Package built successfully.$(RESET)"

########################################################
# Desktop Extension
########################################################

.PHONY: desktop_ext desktop_ext_test

desktop_ext: ## Build the desktop extension for Claude Desktop
	@echo "$(YELLOW)📦Building Open Edison Desktop Extension...$(RESET)"
	@if [ ! -d "desktop_ext" ]; then \
		echo "$(RED)❌ desktop_ext directory not found$(RESET)"; \
		exit 1; \
	fi
	@cd desktop_ext && ./build.sh
	@if [ -f "desktop_ext/desktop_ext.dxt" ]; then \
		cp desktop_ext/desktop_ext.dxt ./open-edison-connector.dxt; \
		echo "$(GREEN)✅Desktop extension copied to $(PROJECT_ROOT)/open-edison-connector.dxt$(RESET)"; \
	elif [ -f "desktop_ext/open-edison-connector.dxt" ]; then \
		cp desktop_ext/open-edison-connector.dxt ./open-edison-connector.dxt; \
		echo "$(GREEN)✅Desktop extension copied to $(PROJECT_ROOT)/open-edison-connector.dxt$(RESET)"; \
	else \
		echo "$(YELLOW)⚠️  Extension file not found, may need DXT CLI installed$(RESET)"; \
		echo "$(YELLOW)Available files in desktop_ext:$(RESET)"; \
		ls -la desktop_ext/; \
	fi
	@echo "$(GREEN)✅Desktop extension built successfully.$(RESET)"
	@echo "$(BLUE)📋 Install in Claude Desktop by dragging open-edison-connector.dxt to Settings → Extensions$(RESET)"

desktop_ext_test: ## Test the desktop extension configuration
	@echo "$(YELLOW)🧪Testing desktop extension configuration...$(RESET)"
	@if [ ! -d "desktop_ext" ]; then \
		echo "$(RED)❌ desktop_ext directory not found$(RESET)"; \
		exit 1; \
	fi
	@cd desktop_ext && node test_connection.js
	@echo "$(GREEN)✅Desktop extension test completed.$(RESET)"

########################################################
# Frontend Website
########################################################

.PHONY: website website_dev website_build website_install

website_install: ## Install frontend dependencies
	@echo "$(YELLOW)📦 Installing frontend deps...$(RESET)"
	@cd frontend && npm install
	@echo "$(GREEN)✅ Frontend deps installed$(RESET)"

website_dev: ## Run the frontend dev server (opens on port 5174 if 5173 busy)
	@echo "$(YELLOW)▶️  Starting frontend dev server...$(RESET)"
	@cd frontend && (npm run dev || npm run dev -- --port 5174)

website_build: ## Build the frontend for production
	@echo "$(YELLOW)🏗️  Building frontend...$(RESET)"
	@cd frontend && npm run build
	@echo "$(GREEN)✅ Frontend build complete$(RESET)"

website: website_install website_dev ## Install and run the frontend website
	@: