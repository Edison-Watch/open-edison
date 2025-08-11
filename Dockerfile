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
    && rm -rf /var/lib/apt/lists/*

# Install rye
ENV RYE_HOME="/opt/rye"
ENV PATH="$RYE_HOME/shims:$PATH"
RUN curl -sSf https://rye.astral.sh/get | RYE_INSTALL_OPTION="--yes" bash

# Copy project files
COPY pyproject.toml ./
COPY requirements*.lock ./
COPY main.py ./
COPY src/ ./src/
COPY --from=frontend /app/frontend/dist ./frontend_dist

# Install dependencies
RUN rye sync --no-dev

# Copy configuration (can be overridden with volume mount)
COPY config.json ./config.json

# Expose ports
EXPOSE 3000 3001 8080

# Serve both: FastAPI/MCP and static website
# Use a simple Python HTTP server for the static site
CMD bash -lc '
  python -m http.server 8080 --directory /app/frontend_dist & \
  python main.py
'