# Changelog

All notable changes to Drasill Cloud will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-02-23

### Added

#### Bank Statement Parsing & Import
- **CSV and PDF bank statement parsing** powered by GPT-4o-mini LLM extraction
- **3-table database schema** — `bank_accounts`, `bank_statements`, `transactions` with full foreign key relationships
- **Batch import** — Import all sibling PDF bank statements in a deal folder simultaneously (concurrency of 3)
- **File-tree integration** — Detect bank statements directly from the file explorer with two-state UI (Import & Analyze / Analyze)
- **Robust JSON extraction** — Brace-depth matching, trailing comma cleanup, and text stripping for reliable LLM response parsing (max_tokens raised to 16,384)

#### Underwriting Analytics Dashboard
- **7 analytics functions** in database: `getDailyBalanceByMonth`, `getDepositCountByMonth`, `getNegativeDaysByMonth`, `getNsfCountByMonth`, `getOverdraftCountByMonth`, `detectMcaPositions`, `getMonthlyBalanceSummary`
- **`get_underwriting_summary` tool** — Full underwriting-grade analysis returning monthly deposits, daily balances, deposit counts, negative days, NSFs, overdrafts, MCA positions, and 3-month aggregates
- **`get_bank_statement_overview` tool** — Qualification workflow showing available accounts, statements, and date ranges before running full analysis
- **`export_underwriting_report` tool** — Export professionally formatted PDF underwriting report with Save dialog
- **Guided qualification workflow** — System prompt instructs AI to present data overview, ask qualifying questions (date range, account selection), then run analysis
- **Fuzzy deal matching** — `findDealByName` with 3-tier fallback (deal_id → deal_identifier → deal_id-as-name) for robust deal resolution

#### Exportable Underwriting PDF Report
- **Professional HTML report** with Drasill branding, monthly data tables, aggregates, MCA positions, and source statement references
- **Hidden BrowserWindow → printToPDF** pipeline following existing export patterns
- **Full IPC wiring** — Tool → actionTaken → renderer → IPC handler → PDF generation → Save dialog

#### New Chat Tools (8 Total)
- `create_deal` — Create deals via natural language
- `update_deal` — Update any deal fields conversationally
- `delete_deal` — Delete deals with confirmation
- `update_activity` — Edit existing activities
- `delete_activity` — Remove activities with confirmation
- `export_deal_pdf` — Export deal reports to PDF
- `search_deal_files` — Browse documents associated with a deal
- `manage_memos` — Create, update, delete memos

#### Chat Tool Progress UI
- **Real-time tool stepper** showing each tool call with status (running/completed)
- **Thinking indicator** with animated dots during AI processing
- **Tool labels** with contextual icons for each tool type

### Fixed
- **Cohere RAG reranker score bug** — `Math.max()` to clamp negative relevance scores
- **Local folder reindexing OneDrive** — Set `workspaceSource: 'local'` and `oneDriveFolderId: null` when opening local folders
- **PDF LLM parse failures** — Raised max_tokens from 4,096 to 16,384 and added robust JSON extraction with brace matching
- **"Deal ID not found" errors** — Underwriting tool now accepts `deal_identifier` string with fuzzy matching instead of requiring exact UUID

### Changed
- System prompt now includes detailed BANK STATEMENT ANALYSIS WORKFLOW and UNDERWRITING SUMMARY FORMAT instructions
- Analyze button in PdfViewer triggers guided qualification flow instead of direct analysis
- Import & Analyze button processes all sibling PDFs in the folder with progress tracking

### Technical Details
- **Build Status:** All main/preload builds clean, no new renderer errors
- **Backward Compatibility:** Fully compatible with v1.1.x data

---

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

- [1.2.0] - Bank Statement Analytics & Underwriting Reports (2025-02-23)
- [1.1.0] - Schematic Visualizer Integration (2025-12-23)
- [1.0.7] - Base Release

[1.2.0]: https://github.com/StephenRoma/Drasill-Cloud/releases/tag/v1.2.0
[1.1.0]: https://github.com/StephenRoma/Drasill-Cloud/releases/tag/v1.1.0
[1.0.7]: https://github.com/StephenRoma/Drasill-Cloud/releases/tag/v1.0.7
