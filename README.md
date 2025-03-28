# mcp-dicionario-da-rag
MCP (Model Context Protocol) implementation to allow LLMs to interact with Dicionario da Real Academia Galega

## Installation & Setup

1. Clone repository:
```bash
git clone https://github.com/yourusername/mcp-dicionario-da-rag.git
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Configure your MCP client (like Claude Desktop) by creating a config file with this structure:

```json
{
    "mcpServers": {
        "galicianDictionary": {
            "command": "node",
            "args": [
                "/path/to/your/mcp-dicionario-da-rag/dist/mcp-server.js"
            ]
        }
    }
}
```

Make sure to replace `/path/to/your/` with your actual project path.
