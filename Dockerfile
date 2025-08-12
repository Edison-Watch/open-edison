# Open Edison Docker Image
FROM node:20-slim AS frontend

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim AS backend

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    bash \
    git \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Ensure Python output is unbuffered and no .pyc files are written
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RYE_HOME=/opt/rye
# Ensure Rye is available at runtime regardless of install path
ENV PATH="${RYE_HOME}/bin:${RYE_HOME}/shims:/root/.rye/bin:/root/.rye/shims:${PATH}"

# Install Rye package manager (non-interactive)
RUN curl -sSf https://rye.astral.sh/get | RYE_INSTALL_OPTION="--yes" bash

# Copy project files
COPY pyproject.toml ./
COPY requirements*.lock ./
COPY README.md LICENSE Makefile ./
COPY main.py ./
COPY src/ ./src/
COPY --from=frontend /app/frontend/dist ./frontend_dist

# Setup project via Makefile (installs dependencies via Rye and creates default config if missing)
RUN make setup

# Copy all configuration files (can be overridden with volume mount)
COPY config.json ./config.json
COPY tool_permissions.json ./tool_permissions.json
COPY resource_permissions.json ./resource_permissions.json
COPY prompt_permissions.json ./prompt_permissions.json

# Expose ports
EXPOSE 3000 3001

# Start the API server via Rye directly (avoid login shell PATH resets)
CMD ["/opt/rye/shims/rye", "run", "python", "main.py"]