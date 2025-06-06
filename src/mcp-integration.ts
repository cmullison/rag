import { Hono } from 'hono';
import { NotesServer, MCPConfig } from './mcp-server';

// This file demonstrates how to integrate the MCP server with your existing Cloudflare Worker

type Env = {
  AI: Ai;
  ANTHROPIC_API_KEY: string;
  DATABASE: D1Database;
  ENABLE_TEXT_SPLITTING: boolean | undefined;
  RAG_WORKFLOW: Workflow;
  VECTOR_INDEX: VectorizeIndex;
};

// Add MCP endpoint to your existing Hono app
export function addMCPEndpoints(app: Hono<{ Bindings: Env }>) {
  // Create MCP server instance with Cloudflare bindings
  app.post('/mcp/initialize', async (c) => {
    const config: MCPConfig = {
      AI: c.env.AI,
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      DATABASE: c.env.DATABASE,
      ENABLE_TEXT_SPLITTING: c.env.ENABLE_TEXT_SPLITTING,
      VECTOR_INDEX: c.env.VECTOR_INDEX,
    };

    // For HTTP-based MCP transport, you would need to implement
    // a custom transport that works with Cloudflare Workers
    // This is a placeholder showing the structure
    return c.json({
      message: "MCP server initialized",
      tools: [
        "query_notes",
        "add_note",
        "list_notes",
        "delete_note"
      ]
    });
  });

  // Example endpoint that uses the MCP server tools directly
  app.post('/mcp/tool/:toolName', async (c) => {
    const toolName = c.req.param('toolName');
    const body = await c.req.json();

    const config: MCPConfig = {
      AI: c.env.AI,
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      DATABASE: c.env.DATABASE,
      ENABLE_TEXT_SPLITTING: c.env.ENABLE_TEXT_SPLITTING,
      VECTOR_INDEX: c.env.VECTOR_INDEX,
    };

    const server = new NotesServer(config);

    // This is a simplified example - in practice, you'd need to
    // properly handle the MCP protocol messages
    try {
      let result;
      switch (toolName) {
        case 'query_notes':
          if (!body.question) {
            return c.json({ error: "Missing question parameter" }, 400);
          }
          // Direct method call - in real MCP, this would go through the protocol
          result = await (server as any).queryNotes(body.question);
          break;

        case 'add_note':
          if (!body.text) {
            return c.json({ error: "Missing text parameter" }, 400);
          }
          result = await (server as any).addNote(body.text);
          break;

        case 'list_notes':
          result = await (server as any).listNotes();
          break;

        case 'delete_note':
          if (!body.id) {
            return c.json({ error: "Missing id parameter" }, 400);
          }
          result = await (server as any).deleteNote(body.id);
          break;

        default:
          return c.json({ error: `Unknown tool: ${toolName}` }, 404);
      }

      return c.json(result);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  });
}

// Alternative: Create a standalone MCP server binary
// This would be used if you want to run the MCP server as a separate process
export async function createStandaloneMCPServer(config: MCPConfig) {
  const server = new NotesServer(config);
  // For standalone mode, you'd need to implement stdio transport
  // This is typically used when running as a subprocess
  console.log("Note: Standalone MCP server requires stdio transport implementation");
  return server;
}
