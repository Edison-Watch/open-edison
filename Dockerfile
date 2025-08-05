# Open Edison Docker Image
FROM python:3.12-slim

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

# Install dependencies
RUN rye sync --no-dev

# Copy configuration (can be overridden with volume mount)
COPY config.json ./config.json

# Expose port
EXPOSE 3000
EXPOSE 3001

# Run the application
CMD ["make", "run"]