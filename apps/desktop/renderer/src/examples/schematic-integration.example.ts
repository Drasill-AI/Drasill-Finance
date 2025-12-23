/**
 * Example: Integrating Schematic Visualizer with Chat
 * 
 * This file shows how to wire up the schematic visualizer tool
 * with your OpenAI chat implementation.
 */

import { useAppStore } from '../store';

/**
 * Example: Handle OpenAI tool calls in your chat handler
 */
export function handleOpenAIToolCall(toolCall: any) {
  const functionName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  switch (functionName) {
    case 'retrieve_schematic':
      // Open schematic tab
      useAppStore.getState().openSchematicTab(args);
      
      // Return result to OpenAI (optional)
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        name: functionName,
        content: JSON.stringify({
          status: 'success',
          message: `Opened schematic for ${args.component_name}`,
        }),
      };

    // Add other tool handlers here
    default:
      console.warn(`Unknown tool: ${functionName}`);
      return null;
  }
}

/**
 * Example: OpenAI Function Definition
 * 
 * Add this to your OpenAI API call or Playground configuration:
 */
export const SCHEMATIC_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'retrieve_schematic',
    description: 'Retrieve equipment schematic diagram and service manual information from local RAG system. Use when user asks to see, view, or show a schematic, diagram, or technical drawing of equipment components.',
    parameters: {
      type: 'object',
      properties: {
        component_name: {
          type: 'string',
          description: 'Name of the component or part to retrieve schematic for (e.g., "hydraulic pump", "circuit board", "motor assembly")',
        },
        machine_model: {
          type: 'string',
          description: 'Machine or equipment model number (e.g., "HX-2000", "PLC-500"). Include if mentioned by user.',
        },
        additional_context: {
          type: 'string',
          description: 'Additional context to help locate the correct schematic (e.g., "front panel", "left side", "control unit")',
        },
      },
      required: ['component_name'],
    },
  },
};

/**
 * Example: Integration with existing chat.ts
 * 
 * In apps/desktop/main/chat.ts, modify your streaming handler:
 */
/*
export async function sendChatMessage(request: ChatRequest): Promise<void> {
  const messages = request.history.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Add user message
  messages.push({
    role: 'user',
    content: request.message,
  });

  // Create stream with tools
  const stream = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages,
    tools: [SCHEMATIC_TOOL_DEFINITION], // Add the tool
    stream: true,
  });

  // Handle streaming response
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    // Check for tool calls
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.function?.name === 'retrieve_schematic') {
          const args = JSON.parse(toolCall.function.arguments);
          
          // Send event to renderer to open schematic
          mainWindow?.webContents.send('chat-tool-executed', {
            action: 'schematic_retrieved',
            data: args,
          });
        }
      }
    }

    // Handle regular content
    if (delta.content) {
      mainWindow?.webContents.send(IPC_CHANNELS.CHAT_STREAM_CHUNK, {
        id: messageId,
        delta: delta.content,
        done: false,
      });
    }
  }
}
*/

/**
 * Example: Listen for tool execution in renderer
 * 
 * In apps/desktop/renderer/src/store/index.ts or component:
 */
/*
useEffect(() => {
  // Set up listener for chat tool executions
  const unsubscribe = window.electronAPI.onChatToolExecuted((data) => {
    if (data.action === 'schematic_retrieved') {
      // Open the schematic tab
      useAppStore.getState().openSchematicTab(data.data);
    }
  });

  return unsubscribe;
}, []);
*/

/**
 * Example: Manual testing in browser console
 */
/*
// Test opening a schematic tab directly
window.testSchematic = () => {
  const { openSchematicTab } = window.useAppStore.getState();
  
  openSchematicTab({
    component_name: "Hydraulic Pump Assembly",
    machine_model: "HX-2000",
    additional_context: "Main pump unit, front left"
  });
};

// Run in console:
// window.testSchematic()
*/

/**
 * Example: OpenAI System Prompt
 * 
 * Add to your system message for better tool usage:
 */
export const SCHEMATIC_SYSTEM_PROMPT = `
You are a technical assistant for equipment maintenance. You have access to a schematic retrieval tool.

When users ask about equipment parts, repairs, or need to see technical drawings:
1. Use the retrieve_schematic tool to show them relevant diagrams
2. Extract component names and model numbers from their questions
3. The schematic will open in a new tab automatically
4. After calling the tool, explain what you showed them

Examples:
- "Show me the pump schematic" → Call tool with component_name: "pump"
- "I need to replace the motor on machine HX-2000" → Call tool with component_name: "motor", machine_model: "HX-2000"
- "Where is the circuit board located?" → Call tool with component_name: "circuit board"

Always confirm what schematic you're showing after the tool call completes.
`;

/**
 * Example: Complete OpenAI API Call
 */
/*
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function chatWithSchematicSupport(userMessage: string, history: any[]) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: SCHEMATIC_SYSTEM_PROMPT,
      },
      ...history,
      {
        role: 'user',
        content: userMessage,
      },
    ],
    tools: [SCHEMATIC_TOOL_DEFINITION],
    tool_choice: 'auto', // Let AI decide when to use tools
  });

  // Handle tool calls
  if (response.choices[0].message.tool_calls) {
    for (const toolCall of response.choices[0].message.tool_calls) {
      const result = handleOpenAIToolCall(toolCall);
      console.log('Tool executed:', result);
    }
  }

  return response.choices[0].message.content;
}
*/

/**
 * Example: Error Handling
 */
/*
try {
  await useAppStore.getState().openSchematicTab({
    component_name: "pump",
    machine_model: "HX-2000",
  });
} catch (error) {
  console.error('Failed to open schematic:', error);
  
  // Show user-friendly error
  useAppStore.getState().showToast('error', 
    'Failed to load schematic. Please check if the Java service is running.'
  );
}
*/

/**
 * Example: Java Service Health Check
 */
/*
async function checkSchematicServiceHealth(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8080/health');
    return response.ok;
  } catch (error) {
    console.warn('Schematic service not available:', error);
    return false;
  }
}

// Check on app startup
checkSchematicServiceHealth().then(isHealthy => {
  if (!isHealthy) {
    console.warn('⚠️ Schematic service is not running. Schematics will not be available.');
    // Optionally show a warning toast
  } else {
    console.log('✅ Schematic service is ready');
  }
});
*/

export default {
  SCHEMATIC_TOOL_DEFINITION,
  SCHEMATIC_SYSTEM_PROMPT,
  handleOpenAIToolCall,
};
