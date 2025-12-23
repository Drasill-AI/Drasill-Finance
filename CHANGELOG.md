# Changelog

All notable changes to Drasill Cloud will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-23

### Added

#### Schematic Visualizer Tool
- **Interactive schematic viewer component** with zoom controls (50%-200%)
- **Service instructions panel** displaying maintenance procedures and specifications
- **AI-powered schematic retrieval** via OpenAI function calling
- **Smart tab management** with automatic deduplication
- **Mock mode** for testing without backend service
- **Download functionality** for saving schematics as images
- **Responsive UI** with dark mode support

#### New Files
- `apps/desktop/main/schematic.ts` - Main process handler for schematic operations
- `apps/desktop/renderer/src/components/SchematicViewer.tsx` - React viewer component
- `apps/desktop/renderer/src/components/SchematicViewer.module.css` - Component styling
- `apps/desktop/renderer/src/examples/schematic-integration.example.ts` - Integration examples

#### Documentation
- `SCHEMATIC_VISUALIZER_README.md` - Complete technical documentation
- `SCHEMATIC_SETUP_GUIDE.md` - Quick start guide
- `IMPLEMENTATION_TEST_REPORT.md` - Testing verification
- `HOW_TO_RUN.md` - Running and deployment guide
- `RELEASE_NOTES.md` - Release details
- `schematic-test.html` - Interactive testing interface
- `SCHEMATIC_TEST_SCRIPT.js` - Console test utilities

#### API Additions
- `IPC_CHANNELS.SCHEMATIC_PROCESS_TOOL_CALL` - IPC channel for tool calls
- `IPC_CHANNELS.SCHEMATIC_GET_IMAGE` - IPC channel for image retrieval
- `processSchematicToolCall()` - Main process handler
- `getSchematicImage()` - Image loading and base64 conversion
- `openSchematicTab()` - Store action for opening schematics

#### Type Definitions
- `SchematicToolCall` - OpenAI function call parameters
- `SchematicToolResponse` - Java service response format
- `SchematicData` - Tab data structure
- Extended `Tab` interface with `'schematic'` type
- Updated `PersistedState` to support schematic tabs

### Changed

#### Modified Files
- `packages/shared/src/index.ts` - Added schematic types and IPC channels
- `apps/desktop/main/ipc.ts` - Added schematic IPC handlers
- `apps/desktop/preload/index.ts` - Exposed schematic APIs to renderer
- `apps/desktop/renderer/src/store/index.ts` - Added schematic state management
- `apps/desktop/renderer/src/components/EditorPane.tsx` - Added schematic viewer routing
- `apps/desktop/renderer/src/components/index.ts` - Exported SchematicViewer
- `apps/desktop/renderer/src/types/electron.d.ts` - Added schematic API types

#### Enhanced Features
- Tab system now supports schematic tabs with dedicated UI
- Editor pane routes to appropriate viewer based on tab type
- State management handles schematic-specific operations
- IPC layer provides type-safe schematic communication

### Technical Details

- **Lines of Code Added:** ~1,978
- **TypeScript Errors:** 0
- **Build Status:** All builds successful
- **Backward Compatibility:** Fully compatible with v1.0.x

### Dependencies

No new dependencies added. Uses existing:
- Electron
- React
- Zustand
- TypeScript
- Vite

### Requirements

For full functionality:
- Java REST API service (localhost:8080)
- OpenAI API key (for chat integration)

### Testing

- Mock mode available for testing without backend
- Interactive test page provided
- Console test scripts included
- Manual test cases documented

---

## [1.0.7] - Previous Release

### Features
- Equipment documentation viewer
- PDF and Word document support
- File explorer with workspace management
- Monaco editor for text files
- AI chat assistant with RAG
- Equipment tracking and maintenance logs
- Analytics dashboard

---

## Release Links

- [1.1.0] - Schematic Visualizer Integration (2025-12-23)
- [1.0.7] - Base Release

[1.1.0]: https://github.com/StephenRoma/Drasill-Cloud/releases/tag/v1.1.0
[1.0.7]: https://github.com/StephenRoma/Drasill-Cloud/releases/tag/v1.0.7
