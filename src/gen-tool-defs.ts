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
  .version('1.0.0');

// Parse arguments
program.parse(process.argv);
const options = program.opts<{ input: string; output: string; force?: boolean }>();

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
    const api = (await SwaggerParser.dereference(inputSpec)) as OpenAPIV3.Document;
    console.error('OpenAPI spec parsed successfully.');

    // Extract tools from the API
    const tools = extractToolsFromApi(api);
    console.error(`Extracted ${tools.length} tool definitions.`);

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