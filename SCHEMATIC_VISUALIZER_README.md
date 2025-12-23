# Schematic Visualizer Tool Integration

This implementation adds a schematic visualizer tool to the Drasill Cloud Electron application. The tool integrates with OpenAI's function calling to retrieve and display component schematics from a local RAG system via a Java REST API.

## Architecture Overview

```
OpenAI Chat (with tool calling)
         ↓
Electron Renderer (React/Zustand)
         ↓
Electron Main Process (IPC)
         ↓
Java REST API (localhost:8080)
         ↓
Local RAG / Vector Store
         ↓
Schematic Images & Manuals
```

## Components Implemented

### 1. Shared Types (`packages/shared/src/index.ts`)
- `SchematicToolCall` - Request format from OpenAI
- `SchematicToolResponse` - Response from Java service
- `SchematicData` - Data stored in schematic tabs
- `Tab` type extended to support `type: 'schematic'`
- New IPC channels for schematic operations

### 2. Main Process Handler (`apps/desktop/main/schematic.ts`)
- `processSchematicToolCall()` - Forwards tool calls to Java REST API
- `getSchematicImage()` - Converts image paths to base64 data URLs
- `checkJavaService()` - Health check for Java service availability
- Mock response fallback for testing without Java service

### 3. IPC Handlers (`apps/desktop/main/ipc.ts`)
- `SCHEMATIC_PROCESS_TOOL_CALL` - Process tool call from renderer
- `SCHEMATIC_GET_IMAGE` - Get schematic image as base64

### 4. Preload Script (`apps/desktop/preload/index.ts`)
- `processSchematicToolCall()` - Exposed to renderer
- `getSchematicImage()` - Exposed to renderer

### 5. State Management (`apps/desktop/renderer/src/store/index.ts`)
- `openSchematicTab()` - Action to create schematic tabs
- Automatically deduplicates tabs by component ID
- Integrates with existing tab management

### 6. React Components
- `SchematicViewer.tsx` - Main viewer component with:
  - Image display with zoom controls
  - Service instructions panel
  - Metadata display
  - Download functionality
- `SchematicViewer.module.css` - Styled with dark mode support

### 7. Layout Integration (`apps/desktop/renderer/src/components/EditorPane.tsx`)
- Renders `SchematicViewer` for tabs with `type === 'schematic'`

## Java REST API Requirements

### Endpoint: `POST /tool-call`

**Request Body:**
```json
{
  "choices": [{
    "message": {
      "tool_calls": [{
        "function": {
          "arguments": "{\"component_name\":\"Water Pump\",\"machine_model\":\"XYZ-123\"}"
        }
      }]
    }
  }]
}
```

**Response:**
```json
{
  "status": "success",
  "component_name": "Water Pump",
  "machine_model": "XYZ-123",
  "component_id": "PUMP-001",
  "image_path": "/path/to/schematic.png",
  "manual_context": "Detailed service instructions..."
}
```

### Endpoint: `GET /health`

Returns 200 OK when service is running.

### Starting the Java Service

```bash
java -jar SchematicToolHandler.jar
```

Or use the Spark Java example provided in the planning document.

## OpenAI Function Definition

Add this tool definition to your OpenAI Playground agent:

```json
{
  "type": "function",
  "function": {
    "name": "retrieve_schematic",
    "description": "Retrieve equipment schematic diagram and service manual information from local RAG system",
    "parameters": {
      "type": "object",
      "properties": {
        "component_name": {
          "type": "string",
          "description": "Name of the component or part to retrieve schematic for"
        },
        "machine_model": {
          "type": "string",
          "description": "Machine or equipment model number (optional)"
        },
        "additional_context": {
          "type": "string",
          "description": "Additional context to help locate the correct schematic (optional)"
        }
      },
      "required": ["component_name"]
    }
  }
}
```

## Usage Flow

### 1. User Interaction
User asks the AI assistant in the chat panel:
```
"Show me the schematic for the hydraulic pump on machine XYZ-123"
```

### 2. OpenAI Tool Call
OpenAI generates a tool call:
```json
{
  "component_name": "hydraulic pump",
  "machine_model": "XYZ-123"
}
```

### 3. Processing
1. Chat handler detects tool call
2. Calls `useAppStore.getState().openSchematicTab(toolCall)`
3. Store action calls `window.electronAPI.processSchematicToolCall()`
4. Main process forwards to Java API
5. Java service queries RAG system
6. Returns schematic path and manual context

### 4. Display
1. New tab opens with schematic viewer
2. Image loads from returned path
3. Service instructions display in side panel
4. User can zoom, download, and reference instructions

## Configuration

### Environment Variables

```bash
# Java service URL (defaults to http://localhost:8080)
JAVA_SCHEMATIC_SERVICE_URL=http://localhost:8080
```

Set in Electron main process or in `.env` file.

## Testing Without Java Service

The implementation includes a mock response mode that activates automatically when the Java service is unavailable. This allows you to:

1. Test the UI components
2. Verify tab creation and switching
3. Debug the frontend without backend dependency

Mock data includes:
- Placeholder schematic path
- Sample service instructions
- Generated component IDs

## Troubleshooting

### Service Not Available Error
**Problem:** "Java service not available, returning mock data"

**Solutions:**
1. Verify Java service is running: `curl http://localhost:8080/health`
2. Check firewall settings
3. Verify port 8080 is not in use by another process

### Image Not Loading
**Problem:** Schematic image shows error icon

**Solutions:**
1. Verify image path from Java response is accessible
2. Check file permissions on image files
3. Ensure image format is supported (PNG, JPG, GIF, SVG, WebP)
4. Check console for detailed error messages

### Tab Not Opening
**Problem:** No tab appears after tool call

**Solutions:**
1. Check browser console for errors
2. Verify `schematicData` is present in tab object
3. Ensure Java service returned `status: "success"`
4. Check that OpenAI tool call format matches expected structure

## Future Enhancements

### Planned Features
- [ ] Auto-start Java service with Electron app
- [ ] Schematic annotation tools (markup, notes)
- [ ] Print schematic functionality
- [ ] Multi-page schematic support
- [ ] Search within service instructions
- [ ] Bookmark/favorite schematics
- [ ] Export schematic + instructions to PDF
- [ ] History of viewed schematics

### Performance Optimizations
- [ ] Cache schematic images in memory
- [ ] Lazy load service instructions
- [ ] Implement image streaming for large files
- [ ] Add thumbnail preview in tab bar

## API Reference

### Store Actions

```typescript
// Open schematic tab from tool call
openSchematicTab: (toolCall: SchematicToolCall) => Promise<void>
```

### Electron API

```typescript
// Process tool call via Java service
processSchematicToolCall: (toolCall: SchematicToolCall) => Promise<SchematicToolResponse>

// Get image as base64 data URL
getSchematicImage: (imagePath: string) => Promise<string>
```

### Types

```typescript
interface SchematicToolCall {
  component_name: string;
  machine_model?: string;
  additional_context?: string;
}

interface SchematicToolResponse {
  status: 'success' | 'error';
  message?: string;
  image_path?: string;
  manual_context?: string;
  component_id?: string;
  component_name?: string;
  machine_model?: string;
}

interface SchematicData {
  componentId: string;
  componentName: string;
  machineModel?: string;
  imagePath: string;
  manualContext: string;
  timestamp: number;
}
```

## Integration with Chat

To integrate with your chat system, add this to your chat tool execution handler:

```typescript
// In your chat handler
if (toolCall.function.name === 'retrieve_schematic') {
  const args = JSON.parse(toolCall.function.arguments);
  await useAppStore.getState().openSchematicTab(args);
}
```

## License

Part of Drasill Cloud - Equipment Documentation Viewer
