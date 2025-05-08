# OpenAPI to MCP Tool Definitions Generator

This tool extracts tool definitions from an OpenAPI specification and generates a TypeScript file with just the `toolDefinitionMap` for use in MCP (Model Context Protocol) applications.

## Installation

```bash
npm install -g openapi-mcp-generator
```

## Usage

### Command Line

```bash
openapi-mcp-tool-generator -i <input-spec> -o <output-file>
```

Options:
- `-i, --input <file_or_url>`: Path or URL to the OpenAPI specification file (JSON or YAML)
- `-o, --output <file>`: Path to the output TypeScript file (e.g., ./toolDefinitions.ts)
- `--force`: Overwrite existing files without prompting

Example:
```bash
openapi-mcp-tool-generator -i ./swagger.json -o ./src/toolDefinitions.ts
```

### Programmatic Usage

You can also use the tool programmatically in your Node.js projects:

```typescript
import { extractToolsFromApi } from 'openapi-mcp-generator/dist/parser/extract-tools.js';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';

async function generateToolDefinitions(specPath: string) {
  // Parse OpenAPI spec
  const api = (await SwaggerParser.dereference(specPath)) as OpenAPIV3.Document;
  
  // Extract tools
  const tools = extractToolsFromApi(api);
  
  // Use the tools...
  console.log(`Generated ${tools.length} tool definitions`);
  return tools;
}
```

## Output Format

The tool generates a TypeScript file with:

1. An `McpToolDefinition` interface
2. A `toolDefinitionMap` Map object containing all the tool definitions
3. The `securitySchemes` from the OpenAPI spec

Example output:
```typescript
/**
 * MCP Tool Definitions generated from OpenAPI spec
 * Generated on: 2023-10-20T15:30:10.123Z
 */

/**
 * Interface for MCP Tool Definition
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  method: string;
  pathTemplate: string;
  executionParameters: { name: string, in: string }[];
  requestBodyContentType?: string;
  securityRequirements: any[];
}

/**
 * Map of tool definitions by name
 */
export const toolDefinitionMap: Map<string, McpToolDefinition> = new Map([
  ["get_user", {
    name: "get_user",
    description: `Get user by ID`,
    inputSchema: {"type":"object","properties":{"userId":{"type":"string"}},"required":["userId"]},
    method: "get",
    pathTemplate: "/users/{userId}",
    executionParameters: [{"name":"userId","in":"path"}],
    requestBodyContentType: undefined,
    securityRequirements: [{"BearerAuth":[]}]
  }],
  // ... more tools
]);

/**
 * Security schemes from the OpenAPI spec
 */
export const securitySchemes = {
  "BearerAuth": {
    "type": "http",
    "scheme": "bearer"
  }
};
```