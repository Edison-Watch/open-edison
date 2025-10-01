# Docker Deployment

## Overview

Open Edison includes Docker support for easy containerized deployment. This is ideal for consistent environments, easy deployment, and isolation from host system dependencies.

## Quick Start

### Build and Run

```bash
# Build the Docker image
make docker_build

# Run the container
make docker_run
```

Services:

- MCP protocol server: `http://localhost:3000/mcp/`
- Management API + dashboard: `http://localhost:3001`

## Manual Docker Commands

### Build Image

```bash
docker build -t open-edison .
```

### Run Container

```bash
# Run with default configuration
docker run -p 3000:3000 -p 3001:3001 open-edison

# Run with custom configuration
docker run -p 3000:3000 -p 3001:3001 \
    -v $(pwd)/config.json:/app/config.json \
    open-edison
```

### Run with Environment Variables

```bash
docker run -p 3000:3000 -p 3001:3001 \
    -e OPEN_EDISON_API_KEY="your-secure-key" \
    open-edison
```

## Docker Compose

### Basic Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  open-edison:
    build: .
    ports:
      - "3000:3000"
      - "3001:3001"
    volumes:
      - ./config.json:/app/config.json:ro
      - ./data:/app/data
    environment:
      - OPEN_EDISON_API_KEY=your-secure-api-key
    restart: unless-stopped
```

### Run with Docker Compose

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Configuration

### Volume Mounts

Mount your configuration and data:

```bash
docker run -p 3000:3000 -p 3001:3001 \
    -v $(pwd)/config.json:/app/config.json:ro \
    -v $(pwd)/data:/app/data \
    -v $(pwd)/logs:/app/logs \
    open-edison
```

**Recommended Mounts**:

- **Config**: `/app/config.json` (read-only)
- **Data**: `/app/data` (for MCP server data)
- **Logs**: `/app/logs` (for persistent logs)

## Networking

### Expose to Network

```yaml
services:
  open-edison:
    ports:
      - "0.0.0.0:3000:3000"  # Expose to all interfaces
      - "0.0.0.0:3001:3001"  # Expose to all interfaces
```

## Development with Docker

```yaml
version: '3.8'

services:
  open-edison-dev:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
      - "3001:3001"
    volumes:
      - .:/app
      - ./config.json:/app/config.json
    environment:
      - OPEN_EDISON_API_KEY=dev-api-key
      - OPEN_EDISON_LOG_LEVEL=DEBUG
    command: python main.py
```

## Multi-Architecture Builds

### Build for Multiple Platforms

```bash
# Build for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 -t open-edison:latest .

# Push to registry
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/open-edison:latest --push .
```

## Health Checks

### Container Health Check

Built into the Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
```

## Next Steps

- **[API Reference](../quick-reference/api_reference.md)** - Using the deployed server
