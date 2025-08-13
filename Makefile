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

lint: check_rye ## Lint code with Ruff (src only)
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

ci: sync lint basedpyright_check test ## Run CI checks (sync deps, lint, type check, tests)
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
	@docker build -t $(DOCKER_IMAGE_NAME):$(DOCKER_IMAGE_TAG) -t $(DOCKER_IMAGE_NAME):latest .
	@echo "$(GREEN)✅Docker image built and tagged as :$(DOCKER_IMAGE_TAG) and :latest.$(RESET)"

docker_run: docker_build ## Run the Docker image
	@echo "$(YELLOW)🔍Running Docker image...$(RESET)"
	@docker run -p 3000:3000 -p 3001:3001 -v $(PWD)/config.json:/app/config.json $(DOCKER_IMAGE_NAME):latest
	@echo "$(GREEN)✅Docker image running on ports 3000 and 3001.$(RESET)"

########################################################
# Package for distribution
########################################################

build: check_rye ## Build the package
	@echo "$(YELLOW)📦Building package...$(RESET)"
	@rye build
	@echo "$(GREEN)✅Package built successfully.$(RESET)"

########################################################
# PyPI packaging and publish
########################################################

.PHONY: clean_dist build_dist check_twine publish_testpypi test_publish publish_pypi

clean_dist: ## Remove dist/ directory
	@echo "$(YELLOW)🧹Cleaning dist directory...$(RESET)"
	@rm -rf dist
	@echo "$(GREEN)✅dist cleaned.$(RESET)"

build_dist: check_rye clean_dist ## Build source and wheel distributions
	@echo "$(YELLOW)📦Building sdist and wheel...$(RESET)"
	@rye build
	@echo "$(GREEN)✅Distributions built in dist/. $(RESET)"

check_twine: check_rye ## Ensure twine is available
	@echo "$(YELLOW)🔍Checking for twine...$(RESET)"
	@rye run python -c "import twine, sys; print('twine', twine.__version__)" || (echo "$(RED)twine not found. Run 'rye sync' to install dev deps.$(RESET)"; exit 1)

publish_testpypi: build_package check_twine ## Upload distributions to TestPyPI
	@echo "$(YELLOW)🚀Uploading to TestPyPI...$(RESET)"
	@echo "$(YELLOW)🔎 Validating metadata with twine check...$(RESET)"
	@rye run python -m twine check dist/*
	@rye run python -m twine upload --skip-existing --repository testpypi dist/* --verbose
	@echo "$(GREEN)✅Upload to TestPyPI complete.$(RESET)"

test_publish: publish_testpypi ## Alias: publish to TestPyPI

publish_pypi: build_package check_twine ## Upload distributions to PyPI (production)
	@echo "$(YELLOW)🚀Uploading to PyPI...$(RESET)"
	@echo "$(YELLOW)🔎 Validating metadata with twine check...$(RESET)"
	@rye run python -m twine check dist/*
	@rye run python -m twine upload --repository pypi dist/* --verbose
	@echo "$(GREEN)✅Upload to PyPI complete.$(RESET)"

# Aliases for publishing to real PyPI
.PHONY: publish release
publish: publish_pypi ## Alias: publish to PyPI (production)

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
# Git Hooks
########################################################

.PHONY: install_git_hooks
install_git_hooks: ## Install project git hooks (pre-push)
	@echo "$(YELLOW)🔧 Installing git hooks...$(RESET)"
	@mkdir -p .git/hooks
	@cp scripts/git-hooks/pre-push .git/hooks/pre-push
	@chmod +x .git/hooks/pre-push
	@echo "$(GREEN)✅ pre-push hook installed.$(RESET)"

########################################################
# Version Management
########################################################

.PHONY: show_version bump_version

# PART can be one of: patch (default), minor, major
PART ?= patch

show_version: ## Show current project version from pyproject.toml
	@$(PYTHON) - <<-'PY'
	import re, sys
	with open('pyproject.toml','r', encoding='utf-8') as f:
	    text = f.read()
	m = re.search(r'^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"\s*$', text, re.MULTILINE)
	if not m:
	    print('Version not found in pyproject.toml', file=sys.stderr)
	    sys.exit(1)
	print(f"Current version: {m.group(1)}.{m.group(2)}.{m.group(3)}")
	PY

bump_version: ## Bump project version in pyproject.toml (PART=patch|minor|major; default: patch) and commit it
	@echo "$(YELLOW)🔧 Bumping $(PART) version in pyproject.toml...$(RESET)"
	@$(PYTHON) scripts/version_bump.py --part $(PART) --commit
	@echo "$(GREEN)✅ Version bumped and committed.$(RESET)"

bump_version_no_commit: ## Bump version without committing (PART=patch|minor|major)
	@echo "$(YELLOW)🔧 Bumping $(PART) version in pyproject.toml (no commit)...$(RESET)"
	@$(PYTHON) scripts/version_bump.py --part $(PART) --no-commit
	@echo "$(GREEN)✅ Version bumped (not committed).$(RESET)"

bump_version_amend: ## Bump version and amend the last commit
	@echo "$(YELLOW)🔧 Bumping $(PART) version and amending last commit...$(RESET)"
	@$(PYTHON) scripts/version_bump.py --part $(PART) --commit --amend
	@echo "$(GREEN)✅ Version bumped and amended into last commit.$(RESET)"

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

########################################################
# Package Build (Python wheel + packaged frontend)
########################################################

.PHONY: build_package
build_package: check_rye clean_dist ## Build frontend, package into src/frontend_dist, then build Python wheel
	@echo "$(YELLOW)🏗️  Building frontend (vite) and packaging Python wheel...$(RESET)"
	@cd frontend && npm install && npm run build
	@echo "$(YELLOW)📦 Syncing built dashboard to src/frontend_dist...$(RESET)"
	@rm -rf src/frontend_dist && mkdir -p src/frontend_dist
	@cp -R frontend/dist/* src/frontend_dist/
	@echo "$(YELLOW)📦 Building Python wheel...$(RESET)"
	@rye build
	@echo "$(GREEN)✅ build_package complete. Wheel contains packaged dashboard (frontend_dist).$(RESET)"