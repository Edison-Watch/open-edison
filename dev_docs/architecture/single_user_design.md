# Single-User Design Decisions

## Overview

Open Edison deliberately embraces a **single-user design philosophy** that prioritizes simplicity, ease of use, and local deployment over complex multi-user features. This document explains the design decisions that differentiate Open Edison from more complex systems like edison.watch.

## Core Design Philosophy

### Simplicity Over Complexity

**Decision**: Choose the simplest possible implementation for every feature.

**Rationale**:

- Lower barrier to entry for users
- Easier to understand, debug, and maintain
- Faster development and iteration cycles
- Reduced attack surface and security considerations

**Examples**:

- JSON configuration instead of database
- Single API key instead of user management
- Process management instead of container orchestration
- File-based logging instead of distributed logging

### Local-First Architecture

**Decision**: Design primarily for local deployment on personal machines.

**Alternatives We Actively did not choose**:

- Cloud-native multi-tenant architecture
- Kubernetes-based deployment
- Microservices architecture

## Configuration Design

See [configuration.md](../core/configuration.md)

## MCP Server and API Design

See [Project Structure](../core/project_structure.md) and [API Reference](../quick-reference/api_reference.md)

## Comparison with edison.watch

### Feature Comparison

| Feature | Open Edison | edison.watch | Justification |
|---------|-------------|--------------|---------------|
| **Users** | Single | Multi-tenant | Simplicity focus |
| **Database** | JSON | PostgreSQL | No DB complexity |
| **Authentication** | API Key | JWT + API Keys | Single user sufficient |
| **Deployment** | Local | Cloud | Local-first philosophy |
| **MCP Management** | Process | Container | Simpler management |
| **Configuration** | File | Database | Version control friendly |

### Maintaining Philosophy

Future enhancements must maintain the core philosophy:

- **Simplicity First**: New features should be optional
- **Local Focus**: Cloud features should be additive
- **Single User**: No multi-tenancy in core
- **Easy Setup**: Maintain quick setup experience

## Conclusion

Open Edison's single-user design philosophy creates a focused, maintainable, and user-friendly MCP proxy that serves as both a production tool for individual users and a learning platform for understanding MCP concepts. The simplicity-first approach enables rapid development and deployment while providing a clear migration path to more complex systems when needed.

The design decisions prioritize:

1. **User Experience**: Quick setup and easy configuration
2. **Developer Experience**: Simple codebase and clear architecture
3. **Operational Simplicity**: Minimal dependencies and maintenance
4. **Evolution Path**: Growth toward edison.watch when needed

This approach validates the core MCP proxy concepts in the simplest possible implementation, providing value immediately while building toward more sophisticated systems.
