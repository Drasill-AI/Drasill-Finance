# Release Notes - v1.2.0: Bank Statement Analytics & Underwriting Reports

**Release Date:** February 23, 2025
**Version:** 1.2.0
**Type:** Major Feature Release

---

## What's New

### Bank Statement Parsing & Import

- **PDF & CSV bank statement parsing** powered by GPT-4o-mini LLM extraction
- **Batch import** all PDF bank statements in a deal folder at once (concurrent processing)
- **File-tree integration** with contextual Import & Analyze buttons
- **3-table schema** bank_accounts, bank_statements, transactions with full referential integrity

### Underwriting Analytics Dashboard

Seven dedicated analytics functions power a professional underwriting summary:

- Monthly Deposits (total deposit volume per month)
- Average Daily Balance (weighted daily balance per month)
- Deposit Counts (number of deposits per month)
- Negative Balance Days (days with negative balance)
- NSF / Returned Items (non-sufficient funds count)
- Overdraft Transactions (overdraft occurrences)
- MCA Positions (merchant cash advance detection)

### Guided Qualification Workflow

When you click Analyze on a bank statement, the AI now:

1. Reviews available data - shows all accounts, statements, and date ranges
2. Asks qualifying questions - date range preferences, which accounts to include
3. Runs full analysis - only after you confirm the scope
4. Offers PDF export - save the report as a professionally formatted PDF

### Exportable Underwriting PDF Report

- Professional layout with Drasill branding and logo
- Monthly data tables for all 7 metrics with cross-month aggregates
- MCA positions table (company, payment, frequency, active status)
- Source statement references
- Save-as dialog for choosing export location

### 8 New Chat Tools

- create_deal - Create deals conversationally
- update_deal - Edit any deal fields via chat
- delete_deal - Remove deals with confirmation
- update_activity - Modify existing activities
- delete_activity - Remove activities with confirmation
- export_deal_pdf - Export deal report to PDF
- search_deal_files - Browse associated documents
- manage_memos - Full memo CRUD via chat

### Chat Tool Progress UI

- Real-time stepper showing each tool call with animated status
- Thinking indicator with animated dots during AI processing
- Contextual icons and labels for every tool type

---

## Bug Fixes

- **Cohere RAG scores** - Fixed negative relevance scores with Math.max() clamping
- **Local folder indexing** - Opening a local folder no longer re-indexes OneDrive
- **PDF parsing reliability** - Raised LLM token limit to 16K and added robust JSON extraction
- **Deal resolution** - Underwriting tools now accept borrower names with fuzzy matching

---

## Installation

Download Drasill Finance Setup 1.2.0.exe from the release assets and run the installer.

---

## Technical Notes

- Electron 29.4.6 / React 18 / TypeScript 5.4
- SQLite via better-sqlite3 with WAL mode
- OpenAI GPT-4o-mini via Supabase Edge Function proxy
- PDF export via hidden BrowserWindow printToPDF pipeline
- All main/preload TypeScript builds clean (zero errors)
- Fully backward compatible with v1.1.x data

---

**Full Changelog:** https://github.com/StephenRoma/Drasill-Cloud/compare/v1.1.0...v1.2.0
