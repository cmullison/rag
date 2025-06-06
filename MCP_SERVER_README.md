# Cloudflare Notes RAG MCP Server

This MCP (Model Context Protocol) server provides tools for interacting with the Cloudflare Notes RAG (Retrieval-Augmented Generation) system. It exposes the note-taking functionality as tools that can be used by AI assistants like Claude.

## Features

The MCP server exposes four main tools:

### 1. `query_notes`

Query notes using RAG with vector search. This tool:

- Takes a question as input
- Searches for relevant notes using vector embeddings
- Uses either Claude (if API key provided) or Llama to generate a response
- Returns the AI-generated answer with context from relevant notes

### 2. `add_note`

Add a new note to the database with automatic vector embedding. This tool:

- Takes text content as input
- Optionally splits long text into chunks (if `ENABLE_TEXT_SPLITTING` is true)
- Stores the note in the D1 database
- Generates vector embeddings using the BGE model
- Indexes the embeddings in Vectorize for semantic search

### 3. `list_notes`

List all notes in the database. This tool:

- Retrieves all notes from the D1 database
- Returns a formatted list with note IDs and truncated content

### 4. `delete_note`

Delete a note by its ID. This tool:

- Takes a note ID as input
- Removes the note from both the D1 database and Vectorize index

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│   MCP Server     │────▶│ Cloudflare      │
│ (Claude, etc.)  │     │ (Notes RAG)      │     │ Services        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                   │ - D1 Database
                                                   │ - Vectorize
                                                   │ - AI Workers
                                                   │ - Anthropic API
```

## Implementation Details

### File Structure

- `src/mcp-server.ts` - Main MCP server implementation
- `src/mcp-integration.ts` - Integration helpers for Cloudflare Workers
- `src/index.ts` - Original Cloudflare Worker application

### Dependencies

The server requires:

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@anthropic-ai/sdk` - For Claude API integration
- `@langchain/textsplitters` - For text chunking
- Cloudflare services (D1, Vectorize, AI Workers)

### Configuration

The server requires a `MCPConfig` object with:

```typescript
type MCPConfig = {
	AI: Ai; // Cloudflare AI binding
	ANTHROPIC_API_KEY?: string; // Optional Claude API key
	DATABASE: D1Database; // D1 database binding
	ENABLE_TEXT_SPLITTING?: boolean; // Enable text chunking
	VECTOR_INDEX: VectorizeIndex; // Vectorize index binding
};
```

## Usage Options

### Option 1: HTTP API Integration

You can integrate the MCP tools into your existing Cloudflare Worker by adding HTTP endpoints:

```typescript
import { addMCPEndpoints } from './mcp-integration';

// In your main app
addMCPEndpoints(app);
```

This adds endpoints like:

- `POST /mcp/tool/query_notes` - Query notes
- `POST /mcp/tool/add_note` - Add a note
- `POST /mcp/tool/list_notes` - List all notes
- `POST /mcp/tool/delete_note` - Delete a note

### Option 2: Standalone MCP Server

For use with Claude Desktop or other MCP clients, you would need to:

1. Create a wrapper script that provides the Cloudflare bindings
2. Implement stdio transport for subprocess communication
3. Configure your MCP client to launch the server

**Note**: The current implementation is designed for Cloudflare Workers environment. Running as a standalone server would require adapters for D1, Vectorize, and other Cloudflare-specific services.

### Option 3: Custom Transport

You can implement a custom transport (e.g., WebSocket, SSE) to connect the MCP server with clients over the network while keeping it within the Cloudflare Workers environment.

## Example Usage

### Query Notes

```json
{
	"tool": "query_notes",
	"arguments": {
		"question": "What are the main points from yesterday's meeting?"
	}
}
```

### Add Note

```json
{
	"tool": "add_note",
	"arguments": {
		"text": "Meeting notes: Discussed Q4 roadmap, agreed on three main priorities..."
	}
}
```

### List Notes

```json
{
	"tool": "list_notes",
	"arguments": {}
}
```

### Delete Note

```json
{
	"tool": "delete_note",
	"arguments": {
		"id": "123e4567-e89b-12d3-a456-426614174000"
	}
}
```

## Development

To extend the server:

1. Add new tools in the `setupHandlers()` method
2. Implement the tool logic as a private method
3. Update the tool list in `ListToolsRequestSchema` handler
4. Add the case in the `CallToolRequestSchema` handler

## Limitations

- The server is tightly coupled with Cloudflare's infrastructure
- Standalone operation requires significant adaptation
- Text splitting is basic and could be improved with more sophisticated chunking strategies
- Vector search is limited to top-K results (currently K=3)

## Future Enhancements

- Add support for updating existing notes
- Implement more sophisticated text chunking strategies
- Add metadata and tagging support
- Support for different embedding models
- Implement note search by date range or other criteria
- Add support for note categories or folders
