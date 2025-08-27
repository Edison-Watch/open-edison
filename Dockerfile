# Open Edison Docker Image
FROM node:20-slim AS frontend

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    bash \
    git \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

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
    PYTHONUNBUFFERED=1

# Install UV package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Add uv to PATH
ENV PATH="/root/.local/bin:${PATH}"

# Copy dependency metadata first for better layer caching
COPY pyproject.toml uv.lock hatch_build.py ./
COPY README.md LICENSE Makefile ./
COPY main.py ./

# Install dependencies without enforcing frontend during editable build
RUN uv sync

# Now copy application code and built dashboard
COPY src/ ./src/
COPY --from=frontend /app/frontend/dist ./frontend_dist


# Copy all configuration files (can be overridden with volume mount)
COPY config.json ./config.json
COPY tool_permissions.json ./tool_permissions.json
COPY resource_permissions.json ./resource_permissions.json
COPY prompt_permissions.json ./prompt_permissions.json

# Expose ports
EXPOSE 3000 3001 50001

# Start the API server via UV
CMD ["uv", "run", "python", "main.py"]