import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    // You might need ErrorResponseSchema if you want to return structured errors
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Import your dictionary client and types
import { GalicianDictionary, DictionaryEntry, Definition } from './galician-dictionary.js'; // Adjust path if needed

// --- Zod Schema for Input Validation ---
const GalicianWordArgumentsSchema = z.object({
    word: z.string().min(1, { message: "A palabra non pode estar baleira." }), // Ensure word is not empty
});

// --- Create MCP Server Instance ---
const server = new Server(
    {
        // Metadata for your MCP tool
        name: "galician-dictionary-lookup",
        // Consider using semantic versioning
        version: "1.0.0",
        // Optional: Add more details like description, author, etc.
        // description: "Un servidor MCP para buscar palabras no dicionario da Real Academia Galega.",
    },
    {
        capabilities: {
            // Declare that this server provides tools
            tools: {},
        },
    }
);

// --- Tool Listing Handler ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("[MCP Server] Received ListTools request.");
    return {
        tools: [
            {
                name: "lookup-galician-word",
                description: "Busca unha palabra no dicionario da Real Academia Galega e devolve as súas definicións, exemplos e expresións.",
                // Define the expected input using JSON Schema format
                // This structure should match the Zod schema above
                inputSchema: {
                    type: "object",
                    properties: {
                        word: {
                            type: "string",
                            description: "A palabra en galego a buscar no dicionario.",
                        },
                    },
                    required: ["word"], // Specify required properties
                },
                // Optional: Define output schema if you want to return structured JSON
                // outputSchema: { ... }
            },
        ],
    };
});

// --- Helper Function to Format Dictionary Entry ---
function formatDictionaryEntry(entry: DictionaryEntry): string {
    let output = `Palabra: ${entry.word}\n`;

    if (entry.partOfSpeech) {
      output += `Categoría gramatical: ${entry.partOfSpeech}\n`;
    }
    output += '\n';

    // Format main definitions
    if (entry.definitions.length > 0) {
      output += 'Definicións:\n';
      entry.definitions.forEach((def) => {
        if (def.sense) {
          output += `${def.sense}. ${def.definition}\n`;
        } else {
          output += `- ${def.definition}\n`;
        }

        def.examples.forEach(example => {
          output += `  Exemplo: ${example}\n`;
        });

        if (def.references) {
          const refTypeText = def.references.type === 'SYNONYM' ? 'Sinónimos' :
                              def.references.type === 'SEE' ? 'Véxase tamén' : 'Confróntese con';
          output += `  ${refTypeText}: ${def.references.words.join(', ')}\n`;
        }
        output += '\n'; // Add a blank line between definitions
      });
    }

    // Format expressions
    if (entry.expressions.length > 0) {
      output += 'Expresións e frases feitas:\n';
      entry.expressions.forEach(expr => {
        output += `\n* ${expr.expression} *\n`; // Highlight the expression

        expr.definitions.forEach((def) => {
          if (def.sense) {
            output += `  ${def.sense}. ${def.definition}\n`;
          } else {
            output += `  - ${def.definition}\n`;
          }

          def.examples.forEach(example => {
            output += `    Exemplo: ${example}\n`;
          });

          if (def.references) {
            const refTypeText = def.references.type === 'SYNONYM' ? 'Sinónimos' :
                                def.references.type === 'SEE' ? 'Véxase tamén' : 'Confróntese con';
            output += `    ${refTypeText}: ${def.references.words.join(', ')}\n`;
          }
           output += '\n'; // Add a blank line between expression definitions
        });
      });
    }

    if (entry.definitions.length === 0 && entry.expressions.length === 0) {
        output += "Non se atoparon definicións ou expresións específicas para esta entrada (aínda que a palabra existe).\n"
    }

    return output.trim(); // Remove trailing newline
}


// --- Tool Call Handler ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { toolCallId, name, arguments: args } = request.params;
    console.error(`[MCP Server] Received CallTool request for "${name}" (ID: ${toolCallId})`);

    // Only handle calls for the defined tool
    if (name !== "lookup-galician-word") {
        // This shouldn't happen if the client uses ListTools correctly, but good practice to check
        console.error(`[MCP Server] Error: Unknown tool name "${name}"`);
        throw new Error(`Ferramenta descoñecida: ${name}`);
    }

    try {
        // 1. Validate input arguments using Zod
        const validatedArgs = GalicianWordArgumentsSchema.parse(args);
        const wordToSearch = validatedArgs.word;
        console.error(`[MCP Server] Validated arguments: Searching for "${wordToSearch}"`);

        // 2. Instantiate your dictionary client
        const dictionary = new GalicianDictionary();

        // 3. Call the client's search method
        const entry = await dictionary.searchWord(wordToSearch);

        // 4. Process the result and format the response
        let responseText: string;
        if (entry) {
            console.error(`[MCP Server] Found entry for "${wordToSearch}". Formatting...`);
            responseText = formatDictionaryEntry(entry);
        } else {
            console.error(`[MCP Server] No entry found for "${wordToSearch}".`);
            responseText = `Non se atoparon resultados para a palabra "${wordToSearch}" no dicionario da RAG.`;
        }

        // 5. Return the result in the MCP format
        return {
            toolCallId, // Echo back the toolCallId
            content: [{ type: "text", text: responseText }],
        };

    } catch (error: any) {
        console.error(`[MCP Server] Error processing tool call for "${name}":`, error);

        // Handle Zod validation errors specifically for better feedback
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
            // Throwing an error here will be caught by the MCP SDK and sent back to the client
            throw new Error(`Argumentos inválidos: ${errorMessages}`);
        }

        // Handle errors from the GalicianDictionary client or other unexpected errors
        // You might want more specific error handling based on potential client errors
        // For now, re-throw a generic error message
        throw new Error(`Erro ao buscar a palabra no dicionario: ${error.message || 'Erro descoñecido'}`);
    }
});

// --- Start the Server ---
async function startServer() {
    // Use Stdio for communication (standard input/output)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Use console.error for logs so they don't interfere with stdout JSON-RPC
    console.error("✅ Galician Dictionary MCP Server running on stdio");
}

startServer().catch((error) => {
    console.error("❌ Fatal error starting MCP server:", error);
    process.exit(1);
});