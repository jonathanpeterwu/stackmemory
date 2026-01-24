# /api - OpenAPI-Based API Access

Execute API calls using OpenAPI specifications via Restish.

## Usage

```bash
# Register an API
stackmemory api add <name> <base-url> [--spec <openapi-url>] [--auth-type api-key]

# List registered APIs
stackmemory api list

# Execute API call
stackmemory api exec <name> <path> [--param value...]

# Configure authentication
stackmemory api auth <name> --token <token> --env-var <VAR_NAME>
```

## Examples

### GitHub API

```bash
# Register
stackmemory api add github https://api.github.com

# Auth (optional)
stackmemory api auth github --token "$GITHUB_TOKEN" --env-var GITHUB_TOKEN

# Execute
stackmemory api exec github /repos/anthropics/anthropic-sdk-python
stackmemory api exec github /users/octocat
stackmemory api exec github /search/repositories --q "language:typescript stars:>1000"
```

### Linear API

```bash
# Register
stackmemory api add linear https://api.linear.app --auth-type api-key

# Auth
stackmemory api auth linear --token "$LINEAR_API_KEY" --env-var LINEAR_API_KEY

# Execute (GraphQL via POST)
stackmemory api exec linear /graphql
```

## How It Works

1. **Registration**: Stores API config in `~/.stackmemory/api-registry.json` and configures Restish
2. **Auth**: Injects tokens from environment variables into request headers
3. **Execution**: Uses Restish CLI for HTTP requests with automatic JSON parsing
4. **Output**: Returns JSON response data

## Requirements

- Restish CLI: `brew install restish`

## Integration

This skill integrates with StackMemory's context system to:
- Track API calls in session history
- Enable context-aware suggestions for common operations
- Store API responses for later retrieval

## See Also

- [Restish Documentation](https://rest.sh/)
- [OpenAPI Specification](https://swagger.io/specification/)
