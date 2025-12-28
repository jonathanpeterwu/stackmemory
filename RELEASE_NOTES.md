# Release Notes - v0.2.6

## 📁 Major Folder Reorganization

### New Structure
- **`src/core/`** - Core business logic (context, projects, monitoring, utils)
- **`src/features/`** - Feature modules (analytics, tasks, browser)
- **`src/integrations/`** - External integrations (Linear, MCP)
- **`src/cli/`** - CLI application with organized commands
- **`src/servers/`** - Server implementations (Railway, production)

### Key Improvements
- ✅ Clearer separation of concerns
- ✅ Better code organization and maintainability
- ✅ Consistent structure throughout codebase
- ✅ Easier navigation and discovery

### Migration
- All imports have been updated automatically
- No breaking changes for API consumers
- Backward compatibility maintained

### New Dependencies
- Added production-ready auth dependencies:
  - `jwks-rsa` - JWT key verification
  - `rate-limiter-flexible` - Rate limiting
  - `ioredis` - Redis client for caching

## 🚀 What's Next
This reorganization sets the foundation for:
- Better testing structure
- Easier feature additions
- Cleaner plugin architecture
- Improved developer experience

## 📦 Installation
```bash
npm install -g @stackmemoryai/stackmemory@0.2.6
```

## 🔧 For Developers
If you have local modifications, run:
```bash
npm run build
npm install -g . --force
```

---
*Built with reorganized architecture for better maintainability*