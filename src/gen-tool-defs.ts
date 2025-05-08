#!/usr/bin/env node
/**
 * OpenAPI to MCP Tool Definitions Generator
 * 
 * This is a standalone tool that generates just the toolDefinitionMap
 * from an OpenAPI specification.
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import { Command } from 'commander';
import fs from 'fs/promises';
import { OpenAPIV3 } from 'openapi-types';
import path from 'path';

import { extractToolsFromApi } from './parser/extract-tools.js';
import { sanitizeForTemplate } from './utils/helpers.js';

// Configure CLI
const program = new Command();

program
  .name('openapi-mcp-tool-generator')
  .description('Generates a toolDefinitionMap file from an OpenAPI specification')
  .requiredOption(
    '-i, --input <file_or_url>',
    'Path or URL to the OpenAPI specification file (JSON or YAML)'
  )
  .requiredOption(
    '-o, --output <file>',
    'Path to the output TypeScript file (e.g., ./toolDefinitions.ts)'
  )
  .option('--force', 'Overwrite existing files without prompting')
  .option(
    '--exclude-tags <tags>',
    'Comma-separated list of tags to exclude from the tool definitions',
    (val) => val.split(',').map(tag => tag.trim())
  )
  .option(
    '--session-cookie <cookie>',
    'Session cookie value for authenticated API requests'
  )
  .version('1.0.0');

// Parse arguments
program.parse(process.argv);
const options = program.opts<{
  input: string;
  output: string;
  force?: boolean;
  excludeTags?: string[];
  sessionCookie?: string;
}>();

/**
 * Generates the tool definition map code
 *
 * @param tools List of tool definitions
 * @param securitySchemes Security schemes from OpenAPI spec
 * @returns Generated code for the tool definition map
 */
function generateToolDefinitionMap(
  tools: any[], // Using any instead of McpToolDefinition to avoid dependency
  securitySchemes?: OpenAPIV3.ComponentsObject['securitySchemes']
): string {
  if (tools.length === 0) return '';

  return tools
    .map((tool) => {
      // Safely stringify complex objects
      let schemaString;
      try {
        schemaString = JSON.stringify(tool.inputSchema);
      } catch (e) {
        schemaString = '{}';
        console.warn(`Failed to stringify schema for tool ${tool.name}: ${e}`);
      }

      let execParamsString;
      try {
        execParamsString = JSON.stringify(tool.executionParameters);
      } catch (e) {
        execParamsString = '[]';
        console.warn(`Failed to stringify execution parameters for tool ${tool.name}: ${e}`);
      }

      let securityReqsString;
      try {
        securityReqsString = JSON.stringify(tool.securityRequirements);
      } catch (e) {
        securityReqsString = '[]';
        console.warn(`Failed to stringify security requirements for tool ${tool.name}: ${e}`);
      }

      // Sanitize description for template literal
      const escapedDescription = sanitizeForTemplate(tool.description);

      // Build the tool definition entry
      return `
  ["${tool.name}", {
    name: "${tool.name}",
    tags: ${JSON.stringify(tool.tags)},
    description: \`${escapedDescription}\`,
    inputSchema: ${schemaString},
    method: "${tool.method}",
    pathTemplate: "${tool.pathTemplate}",
    executionParameters: ${execParamsString},
    requestBodyContentType: ${tool.requestBodyContentType ? `"${tool.requestBodyContentType}"` : 'undefined'},
    securityRequirements: ${securityReqsString}
  }],`;
    })
    .join('');
}

/**
 * Checks if a string is a URL
 * 
 * @param str String to check
 * @returns True if the string is a URL, false otherwise
 */
function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Fetches content from a URL
 * 
 * @param url URL to fetch
 * @param sessionCookie Optional session cookie for authenticated requests
 * @returns Fetched content as string
 */
async function fetchFromUrl(url: string, sessionCookie?: string): Promise<string> {
  console.error(`Fetching spec from URL: ${url}`);

  // Get session cookie from environment variable if not provided as parameter
  const cookieValue = sessionCookie || process.env.AUGUST_SESSION_COOKIE;

  // Setup headers based on the curl example
  const headers: HeadersInit = {
    'Accept': 'application/json,*/*',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://api.staging.augusthealth.com/docs/swagger-ui/index.html',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  };

  // Add cookie header if available
  if (cookieValue) {
    console.error('Using session cookie for authentication');
    headers['Cookie'] = `AugustSession=${cookieValue}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Check if it's JSON or text
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return JSON.stringify(data);
    } else {
      return await response.text();
    }
  } catch (error: any) {
    throw new Error(`Failed to fetch from URL ${url}: ${error.message}`);
  }
}

/**
 * Handles the input specification, whether it's a file path or URL
 * 
 * @param input Input specification path or URL
 * @param sessionCookie Optional session cookie for authenticated requests
 * @returns Parsed OpenAPI document
 */
async function handleInput(input: string, sessionCookie?: string): Promise<OpenAPIV3.Document> {
  if (isUrl(input)) {
    try {
      // Try direct URL handling first, but only if no session cookie is needed
      if (!sessionCookie && !process.env.AUGUST_SESSION_COOKIE) {
        return await SwaggerParser.dereference(input) as OpenAPIV3.Document;
      } else {
        throw new Error('Session cookie provided, using manual fetch');
      }
    } catch (error) {
      // If direct URL handling fails or session cookie is needed, try manual fetch
      console.error(`Using manual fetch for URL: ${error}`);
      const content = await fetchFromUrl(input, sessionCookie);

      // Write to a temporary file and parse that
      const tempFile = path.join(process.cwd(), '.temp-spec.json');
      await fs.writeFile(tempFile, content);

      try {
        const result = await SwaggerParser.dereference(tempFile) as OpenAPIV3.Document;
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => { });
        return result;
      } catch (parseError) {
        // Clean up temp file even on error
        await fs.unlink(tempFile).catch(() => { });
        throw parseError;
      }
    }
  } else {
    // It's a local file path
    return await SwaggerParser.dereference(input) as OpenAPIV3.Document;
  }
}

/**
 * Main function to run the tool definitions generator
 */
async function main() {
  const inputSpec = options.input;
  const outputFile = options.output;

  try {
    // Check if output file exists
    if (!options.force) {
      try {
        const fileExists = await fs.stat(outputFile).catch(() => false);
        if (fileExists) {
          console.error(`Error: Output file ${outputFile} already exists.`);
          console.error('Use --force to overwrite existing file.');
          process.exit(1);
        }
      } catch (err) {
        // File doesn't exist, which is fine
      }
    }

    // Create parent directory if it doesn't exist
    const outputDir = path.dirname(outputFile);
    if (!(await fs.stat(outputDir).catch(() => false))) {
      await fs.mkdir(outputDir, { recursive: true, });
    }

    // Parse OpenAPI spec
    console.error(`Parsing OpenAPI spec: ${inputSpec}`);
    const api = await handleInput(inputSpec, options.sessionCookie);
    console.error('OpenAPI spec parsed successfully.');

    // Extract tools from the API
    let tools = extractToolsFromApi(api);

    // Filter out tools with excluded tags
    if (options.excludeTags && options.excludeTags.length > 0) {
      const excludeTags = options.excludeTags;
      const originalCount = tools.length;

      tools = tools.filter(tool => {
        // Keep tools that don't have any of the excluded tags
        return !tool.tags.some(tag => excludeTags.includes(tag));
      });

      console.error(`Excluded ${originalCount - tools.length} tools with tags: ${excludeTags.join(', ')}`);
    }

    console.error(`Using ${tools.length} tool definitions.`);

    // Generate the tool definition map
    const toolDefinitionMapCode = generateToolDefinitionMap(tools, api.components?.securitySchemes);

    // Create the full output file content
    const outputContent = `/**
 * MCP Tool Definitions generated from OpenAPI spec
 * Generated on: ${new Date().toISOString()}
 */

/**
 * Interface for MCP Tool Definition
 */
export interface McpToolDefinition {
  name: string;
  tags?: string[];
  description: string;
  inputSchema: any;
  method: string;
  pathTemplate: string;
  executionParameters: { name: string, in: string }[];
  requestBodyContentType?: string;
  securityRequirements: any[];

  defaults?: Record<string, { in: "query", value: string }>;
  fields?: string;
}

/**
 * Map of tool definitions by name
 */
export const toolDefinitionMap: Map<string, McpToolDefinition> = new Map([
${toolDefinitionMapCode}
]);

/**
 * Security schemes from the OpenAPI spec
 */
export const securitySchemes = ${JSON.stringify(api.components?.securitySchemes || {}, null, 2)};
`;

    // Write the file
    await fs.writeFile(outputFile, outputContent);
    console.error(`Tool definitions written to ${outputFile}`);
    console.error(`Generated ${tools.length} tool definitions.`);

  } catch (error) {
    console.error('\nError generating tool definitions:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});