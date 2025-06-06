import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { TextBlock } from '@anthropic-ai/sdk/resources';
import Anthropic from '@anthropic-ai/sdk';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// Types from the original application
type Note = {
  id: string;
  text: string;
}

type MCPConfig = {
  AI: Ai;
  ANTHROPIC_API_KEY?: string;
  DATABASE: D1Database;
  ENABLE_TEXT_SPLITTING?: boolean;
  VECTOR_INDEX: VectorizeIndex;
};

class NotesServer {
  private server: Server;
  private config: MCPConfig;

  constructor(config: MCPConfig) {
    this.config = config;
    this.server = new Server(
      {
        name: "cloudflare-notes-rag",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "query_notes",
            description: "Query notes using RAG (Retrieval-Augmented Generation) with vector search",
            inputSchema: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "The question or query to search for in the notes",
                },
              },
              required: ["question"],
            },
          },
          {
            name: "add_note",
            description: "Add a new note to the database with automatic vector embedding",
            inputSchema: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                  description: "The text content of the note to add",
                },
              },
              required: ["text"],
            },
          },
          {
            name: "list_notes",
            description: "List all notes in the database",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "delete_note",
            description: "Delete a note by its ID",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "The ID of the note to delete",
                },
              },
              required: ["id"],
            },
          },
        ] as Tool[],
      };
    });

        // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "query_notes":
            if (!args || typeof args.question !== 'string') {
              throw new Error("Missing required parameter: question");
            }
            return await this.queryNotes(args.question);

          case "add_note":
            if (!args || typeof args.text !== 'string') {
              throw new Error("Missing required parameter: text");
            }
            return await this.addNote(args.text);

          case "list_notes":
            return await this.listNotes();

          case "delete_note":
            if (!args || typeof args.id !== 'string') {
              throw new Error("Missing required parameter: id");
            }
            return await this.deleteNote(args.id);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async queryNotes(question: string) {
    const { AI, ANTHROPIC_API_KEY, DATABASE, VECTOR_INDEX } = this.config;

    // Generate embeddings for the question
    const embeddings = await AI.run('@cf/baai/bge-base-en-v1.5', { text: question });
    const vectors = embeddings.data[0];

    // Query vector index
    const vectorQuery = await VECTOR_INDEX.query(vectors, { topK: 3 });
    const vecIds = vectorQuery.matches.map(vec => vec.id);

    let notes: string[] = [];
    if (vecIds.length) {
      const query = `SELECT * FROM notes WHERE id IN (${vecIds.map(() => '?').join(', ')})`;
      const { results } = await DATABASE.prepare(query).bind(...vecIds).all<Note>();
      if (results) notes = results.map(note => note.text);
    }

    const contextMessage = notes.length
      ? `Context:\n${notes.map(note => `- ${note}`).join("\n")}`
      : "";

    const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`;

    let response: string;
    let modelUsed: string;

    if (ANTHROPIC_API_KEY) {
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const model = "claude-3-5-sonnet-latest";
      modelUsed = model;

      const message = await anthropic.messages.create({
        max_tokens: 1024,
        model,
        messages: [{ role: 'user', content: question }],
        system: [systemPrompt, contextMessage].filter(Boolean).join(" ")
      });

      response = (message.content as TextBlock[]).map(content => content.text).join("\n");
    } else {
      const model = "@cf/meta/llama-3.1-8b-instruct";
      modelUsed = model;

      const aiResponse = await AI.run(
        model,
        {
          messages: [
            ...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
          ] as RoleScopedChatInput[]
        }
      ) as AiTextGenerationOutput;

      response = (aiResponse as any).response;
    }

    return {
      content: [
        {
          type: "text",
          text: response,
        },
        {
          type: "text",
          text: `\n\n[Model used: ${modelUsed}]${notes.length ? `\n[Found ${notes.length} relevant notes]` : ''}`,
        },
      ],
    };
  }

  private async addNote(text: string) {
    const { AI, DATABASE, VECTOR_INDEX, ENABLE_TEXT_SPLITTING } = this.config;

    let texts: string[] = [text];

    // Split text if enabled
    if (ENABLE_TEXT_SPLITTING) {
      const splitter = new RecursiveCharacterTextSplitter({
        // These can be customized to change the chunking size
        //chunkSize: 1000,
        //chunkOverlap: 200,
      });
      const output = await splitter.createDocuments([text]);
      texts = output.map(doc => doc.pageContent);
    }

    const createdNotes: Note[] = [];

    for (const [index, chunk] of texts.entries()) {
      // Create database record
      const query = "INSERT INTO notes (text) VALUES (?) RETURNING *";
      const { results } = await DATABASE.prepare(query).bind(chunk).run<Note>();
      const record = results[0];

      if (!record) throw new Error("Failed to create note");
      createdNotes.push(record);

      // Generate embedding
      const embeddings = await AI.run('@cf/baai/bge-base-en-v1.5', { text: chunk });
      const values = embeddings.data[0];

      if (!values) throw new Error("Failed to generate vector embedding");

      // Insert into vector index
      await VECTOR_INDEX.upsert([
        {
          id: record.id.toString(),
          values: values,
        }
      ]);
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully added note${texts.length > 1 ? `s (split into ${texts.length} chunks)` : ''}. IDs: ${createdNotes.map(n => n.id).join(', ')}`,
        },
      ],
    };
  }

  private async listNotes() {
    const query = `SELECT * FROM notes`;
    const { results } = await this.config.DATABASE.prepare(query).all<Note>();

    if (!results || results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No notes found.",
          },
        ],
      };
    }

    const notesList = results.map((note, index) =>
      `${index + 1}. [ID: ${note.id}] ${note.text.substring(0, 100)}${note.text.length > 100 ? '...' : ''}`
    ).join('\n');

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} notes:\n\n${notesList}`,
        },
      ],
    };
  }

  private async deleteNote(id: string) {
    const { DATABASE, VECTOR_INDEX } = this.config;

    // Check if note exists
    const checkQuery = `SELECT * FROM notes WHERE id = ?`;
    const { results } = await DATABASE.prepare(checkQuery).bind(id).all<Note>();

    if (!results || results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Note with ID ${id} not found.`,
          },
        ],
        isError: true,
      };
    }

    // Delete from database
    const deleteQuery = `DELETE FROM notes WHERE id = ?`;
    await DATABASE.prepare(deleteQuery).bind(id).run();

    // Delete from vector index
    await VECTOR_INDEX.deleteByIds([id]);

    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted note with ID ${id}.`,
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Cloudflare Notes RAG MCP server running on stdio");
  }
}

// Export for use in Cloudflare Workers or standalone
export { NotesServer };
export type { MCPConfig };
