# Contributing to Open Edison

Thank you for your interest in contributing to Open Edison! This guide will help you get started with contributing to the single-user MCP proxy server.

## 🎯 **Project Vision**

Open Edison is designed to be:

- **Simple**: Easy to understand, setup, and use
- **Single-user focused**: No multi-tenancy complexity  
- **Local-first**: Designed for self-hosting
- **Educational**: Great for learning MCP concepts
- **Gateway**: Bridge to more complex systems like edison.watch

## 🚀 **Getting Started**

### Prerequisites

- **Python 3.12+**
- **Rye** for dependency management
- **Git** for version control

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Edison-Watch/open-edison.git
cd open-edison

# Install dependencies
make setup

# Start development server
make run
```

## 📋 **Ways to Contribute**

### 1. **Bug Reports** 🐛

Found a bug? Please create an issue with:

- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (OS, Python version, etc.)
- **Configuration** (sanitized `config.json`)

**Template**:

```markdown
## Bug Description
Brief description of the issue

## Steps to Reproduce
1. Configure server with...
2. Run command...
3. See error...

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: macOS 14.0
- Python: 3.12.0
- Open Edison: 0.1.0
```

### 2. **Feature Requests** ✨

Have an idea? Open an issue with:

- **Clear use case** for the feature
- **Proposed solution** (if you have one)
- **Alternatives considered**
- **Impact on simplicity** (stay true to our philosophy)

### 3. **Documentation** 📚

Documentation improvements are always welcome:

- Fix typos or unclear instructions
- Add examples and use cases
- Improve API documentation
- Create tutorials

### 4. **Code Contributions** 💻

See [Development Guidelines](#development-guidelines) below.

## 🛠️ **Development Guidelines**

### Code Style

We use automated tools to maintain code quality:

```bash
# Format code
make format

# Lint code  
make lint

# Run all checks
make ci
make test
```

**Standards**:

- **uv** for formatting (`make format`)
- **Ruff** for linting (`make lint`)
- **Type hints** for all function signatures
- **Docstrings** for public functions and classes

### Code Organization

```python
# Import order
import json          # Standard library
from pathlib import Path

import uvicorn       # Third party
from fastapi import FastAPI

from src.config import Config  # Project imports at top-level
```

### Naming Conventions

- **Classes**: `PascalCase` (`OpenEdisonProxy`)
- **Functions**: `snake_case` (`start_server`)
- **Variables**: `snake_case` (`server_name`)
- **Constants**: `UPPER_SNAKE_CASE` (`DEFAULT_PORT`)
- **Files**: `snake_case` (`mcp_proxy.py`)

### Testing

All code changes should include tests:

```bash
# Run all tests
make test

# Run specific test file
pytest tests/test_config.py

# Run with coverage
pytest --cov=src tests/
```

**Test Guidelines**:

- Unit tests for individual functions
- Integration tests for API endpoints
- Configuration tests for config loading
- Use descriptive test names

### Documentation

Update documentation for any changes:

- **Code changes**: Update relevant docs
- **API changes**: Update API reference
- **Configuration**: Update config guide
- **New features**: Add usage examples

## 🔄 **Contribution Workflow**

### 1. **Fork and Clone**

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/your-username/open-edison.git
cd open-edison

# Add upstream remote
git remote add upstream https://github.com/Edison-Watch/open-edison.git
```

### 2. **Create Feature Branch**

```bash
# Create and switch to feature branch
git checkout -b feature/your-feature-name

# Or for bugfixes
git checkout -b fix/issue-description
```

### 3. **Make Changes**

- Write your code
- Add tests
- Update documentation
- Follow code style guidelines

### 4. **Test Changes**

```bash
# Run full test suite
make ci

# Test your specific changes
pytest tests/test_your_feature.py

# Manual testing
make dev
# Test your feature manually
```

### 5. **Commit Changes**

Use conventional commit messages:

```bash
# Good commit messages
git commit -m "feat: add MCP server auto-restart functionality"
git commit -m "fix: resolve authentication header parsing issue"
git commit -m "docs: update configuration guide with examples"
git commit -m "test: add integration tests for proxy endpoints"
```

**Commit Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `style`: Code style changes
- `ci`: CI/CD changes

### 6. **Push and Create PR**

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create pull request on GitHub
```

### 7. **Pull Request Guidelines**

**PR Title**: Use conventional commit format

```
feat: add support for WebSocket MCP servers
```

**PR Description**:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature  
- [ ] Documentation update
- [ ] Refactoring

## Testing
- [ ] Tests added/updated
- [ ] Manual testing performed
- [ ] CI checks pass

## Documentation
- [ ] Documentation updated
- [ ] API reference updated (if applicable)

## Related Issues
Closes #123
```

## 🧪 **Testing Guidelines**

### Test Structure

```python
def test_feature_behavior():
    """Test that feature behaves correctly under normal conditions."""
    # Arrange
    config = create_test_config()
    
    # Act  
    result = feature_function(config)
    
    # Assert
    assert result.status == "success"
    assert len(result.items) == 2
```

### Test Categories

1. **Unit Tests**: Test individual functions
2. **Integration Tests**: Test API endpoints
3. **Configuration Tests**: Test config loading/validation
4. **End-to-End Tests**: Test complete workflows

### Test Data

Use fixtures for test data:

```python
@pytest.fixture
def sample_config():
    return Config(
        server=ServerConfig(host="localhost", port=3000),
        logging=LoggingConfig(level="INFO"),
        mcp_servers=[
            MCPServerConfig(name="test", command="echo", args=["hello"])
        ]
    )
```

## 📝 **Documentation Standards**

### Writing Style

- **Clear and concise**: Easy to understand
- **Example-driven**: Show don't just tell  
- **Complete**: Cover all major use cases
- **Current**: Keep up to date with code

### Documentation Types

1. **API Documentation**: Complete endpoint reference
2. **User Guides**: How to use features
3. **Developer Docs**: Architecture and development
4. **Examples**: Working code samples

### Markdown Standards

```markdown
# Main Heading

## Section Heading

### Subsection

**Bold text** for emphasis
`code` for inline code
```

```bash
# Code blocks with language
command --option value
```

## 🚨 **Design Principles**

### Simplicity First

Ask yourself:

- Does this maintain simplicity?
- Can a new user understand this quickly?
- Does this add unnecessary complexity?

### Single-User Focus

Features should:

- Work for individual users
- Not require multi-user infrastructure
- Be appropriate for local deployment

### Local-First

Consider:

- Does this work offline?
- Are there cloud dependencies?
- Can users own their data?

### Example: Feature Decision Framework

```markdown
## Feature: Advanced Logging Dashboard

### Pros
- Better visibility into MCP server activity
- Useful for debugging

### Cons  
- Adds web UI complexity
- Requires frontend development
- May violate simplicity principle

### Decision
- Start with simple log files
- Consider basic web UI in future
- Maintain command-line access
```

## 🎯 **Good First Issues**

Looking for ways to contribute? Try these:

### 🌱 **Beginner Friendly**

- Fix typos in documentation
- Add examples to configuration guide
- Improve error messages
- Add unit tests for utility functions

### 🔧 **Intermediate**

- Implement new API endpoints
- Add MCP server health checks
- Improve configuration validation
- Add integration tests

### 🚀 **Advanced**

- WebSocket support for MCP protocol
- Session logging with SQLite
- Plugin system for MCP servers
- Performance optimizations

## ❓ **Getting Help**

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and ideas
- **Pull Request Reviews**: Code-specific discussions

### Questions Before Contributing

1. **Is this change aligned with project goals?**
2. **Does this maintain simplicity?**  
3. **Will this work for single-user deployment?**
4. **Are there tests for this change?**
5. **Is documentation updated?**

## 🎉 **Recognition**

Contributors are recognized in:

- `CONTRIBUTORS.md` file
- Release notes for significant contributions
- GitHub contributor statistics

## 📜 **Code of Conduct**

We follow a simple code of conduct:

1. **Be respectful** and considerate
2. **Be collaborative** and helpful
3. **Be patient** with new contributors
4. **Focus on the project goals**
5. **Maintain professional discourse**

## 🔄 **Release Process**

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes

### Release Schedule

- **Patch releases**: As needed for bug fixes
- **Minor releases**: Monthly for new features
- **Major releases**: When significant breaking changes accumulate

---

## 🎯 **Summary**

Contributing to Open Edison should be:

- **Simple**: Easy process to follow
- **Welcoming**: Helpful to new contributors  
- **Focused**: Aligned with project goals
- **Quality**: Maintains high standards

Thank you for contributing to Open Edison! Your help makes the project better for everyone. 🚀
