/**
 * Database module for Deal Management
 * Uses better-sqlite3 for synchronous SQLite access
 */

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { Deal, DealActivity, DealStage, DealActivityType, PipelineAnalytics, ChatSession, ChatSessionFull, ChatMessage, ChatSessionSource, ActivitySource } from '@drasill/shared';

let db: Database.Database | null = null;

/**
 * Get the database file path
 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'drasill.db');
}

/**
 * Initialize the database connection and schema
 */
export function initDatabase(): void {
  if (db) return;
  
  const dbPath = getDbPath();
  console.log('Initializing database at:', dbPath);
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  initializeSchema();
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Get the database instance
 */
export function getDatabase(): Database.Database | null {
  return db;
}

/**
 * Initialize database schema
 */
function initializeSchema(): void {
  if (!db) return;

  db.exec(`
    -- Deals table
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      deal_number TEXT NOT NULL UNIQUE,
      borrower_name TEXT NOT NULL,
      borrower_contact TEXT,
      loan_amount REAL NOT NULL DEFAULT 0,
      interest_rate REAL,
      term_months INTEGER,
      collateral_description TEXT,
      stage TEXT DEFAULT 'lead' CHECK(stage IN ('lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined')),
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
      assigned_to TEXT,
      document_path TEXT,
      notes TEXT,
      expected_close_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Deal activities table
    CREATE TABLE IF NOT EXISTS deal_activities (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('note', 'call', 'email', 'document', 'meeting')),
      description TEXT NOT NULL,
      performed_by TEXT,
      performed_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
    CREATE INDEX IF NOT EXISTS idx_deals_borrower ON deals(borrower_name);
    CREATE INDEX IF NOT EXISTS idx_activities_deal ON deal_activities(deal_id);
    CREATE INDEX IF NOT EXISTS idx_activities_type ON deal_activities(type);

    -- Chat sessions table
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deal_id TEXT,
      deal_name TEXT,
      sources TEXT DEFAULT '[]',
      message_count INTEGER DEFAULT 0,
      first_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL
    );

    -- Chat messages table
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rag_sources TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    -- Chat session indexes
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_deal ON chat_sessions(deal_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

    -- Activity sources table (for document citations)
    CREATE TABLE IF NOT EXISTS activity_sources (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      section TEXT,
      page_number INTEGER,
      source TEXT,
      onedrive_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (activity_id) REFERENCES deal_activities(id) ON DELETE CASCADE
    );

    -- Activity sources index
    CREATE INDEX IF NOT EXISTS idx_activity_sources_activity ON activity_sources(activity_id);
  `);
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Generate deal number
 */
function generateDealNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DEAL-${year}-${random}`;
}

// =============================================================================
// DEAL OPERATIONS
// =============================================================================

/**
 * Create a new deal
 */
export function createDeal(data: Partial<Deal>): Deal {
  if (!db) throw new Error('Database not initialized');
  
  const id = generateId();
  const dealNumber = data.dealNumber || generateDealNumber();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO deals (id, deal_number, borrower_name, borrower_contact, loan_amount, interest_rate, term_months, collateral_description, stage, priority, assigned_to, document_path, notes, expected_close_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    dealNumber,
    data.borrowerName || 'Unknown',
    data.borrowerContact || null,
    data.loanAmount || 0,
    data.interestRate || null,
    data.termMonths || null,
    data.collateralDescription || null,
    data.stage || 'lead',
    data.priority || 'medium',
    data.assignedTo || null,
    data.documentPath || null,
    data.notes || null,
    data.expectedCloseDate || null,
    now,
    now
  );
  
  return getDeal(id)!;
}

/**
 * Get a deal by ID
 */
export function getDeal(id: string): Deal | null {
  if (!db) throw new Error('Database not initialized');
  
  const row = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as any;
  if (!row) return null;
  
  return mapRowToDeal(row);
}

/**
 * Get all deals
 */
export function getAllDeals(): Deal[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM deals ORDER BY updated_at DESC').all() as any[];
  return rows.map(mapRowToDeal);
}

/**
 * Update a deal
 */
export function updateDeal(id: string, data: Partial<Deal>): Deal | null {
  if (!db) throw new Error('Database not initialized');
  
  const existing = getDeal(id);
  if (!existing) return null;
  
  const now = new Date().toISOString();
  
  // Auto-create activity if stage changed
  if (data.stage && data.stage !== existing.stage) {
    createDealActivity({
      dealId: id,
      type: 'note',
      description: `Stage changed from "${existing.stage}" to "${data.stage}"`,
      performedBy: 'System'
    });
  }
  
  const stmt = db.prepare(`
    UPDATE deals SET
      borrower_name = COALESCE(?, borrower_name),
      borrower_contact = COALESCE(?, borrower_contact),
      loan_amount = COALESCE(?, loan_amount),
      interest_rate = COALESCE(?, interest_rate),
      term_months = COALESCE(?, term_months),
      collateral_description = COALESCE(?, collateral_description),
      stage = COALESCE(?, stage),
      priority = COALESCE(?, priority),
      assigned_to = COALESCE(?, assigned_to),
      document_path = COALESCE(?, document_path),
      notes = COALESCE(?, notes),
      expected_close_date = COALESCE(?, expected_close_date),
      updated_at = ?
    WHERE id = ?
  `);
  
  stmt.run(
    data.borrowerName,
    data.borrowerContact,
    data.loanAmount,
    data.interestRate,
    data.termMonths,
    data.collateralDescription,
    data.stage,
    data.priority,
    data.assignedTo,
    data.documentPath,
    data.notes,
    data.expectedCloseDate,
    now,
    id
  );
  
  return getDeal(id);
}

/**
 * Delete a deal
 */
export function deleteDeal(id: string): boolean {
  if (!db) throw new Error('Database not initialized');
  
  const result = db.prepare('DELETE FROM deals WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Detect deal from file path
 */
export function detectDealFromPath(filePath: string): Deal | null {
  if (!db) throw new Error('Database not initialized');
  
  // Try to match by document_path
  const byPath = db.prepare('SELECT * FROM deals WHERE document_path = ?').get(filePath) as any;
  if (byPath) return mapRowToDeal(byPath);
  
  // Try to match by folder structure
  const pathParts = filePath.split(/[/\\]/);
  for (const part of pathParts.reverse()) {
    const byName = db.prepare('SELECT * FROM deals WHERE borrower_name LIKE ?').get(`%${part}%`) as any;
    if (byName) return mapRowToDeal(byName);
    
    const byNumber = db.prepare('SELECT * FROM deals WHERE deal_number LIKE ?').get(`%${part}%`) as any;
    if (byNumber) return mapRowToDeal(byNumber);
  }
  
  return null;
}

// =============================================================================
// DEAL ACTIVITY OPERATIONS
// =============================================================================

/**
 * Create a deal activity
 */
export function createDealActivity(data: Partial<DealActivity>): DealActivity {
  if (!db) throw new Error('Database not initialized');
  
  const id = generateId();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO deal_activities (id, deal_id, type, description, performed_by, performed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    data.dealId,
    data.type || 'note',
    data.description || '',
    data.performedBy || null,
    data.performedAt || now,
    now
  );
  
  // Update deal's updated_at
  if (data.dealId) {
    db.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').run(now, data.dealId);
  }
  
  return getDealActivity(id)!;
}

/**
 * Get a deal activity by ID
 */
export function getDealActivity(id: string): DealActivity | null {
  if (!db) throw new Error('Database not initialized');
  
  const row = db.prepare('SELECT * FROM deal_activities WHERE id = ?').get(id) as any;
  if (!row) return null;
  
  return mapRowToActivity(row);
}

/**
 * Get activities for a deal
 */
export function getActivitiesForDeal(dealId: string): DealActivity[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM deal_activities WHERE deal_id = ? ORDER BY performed_at DESC').all(dealId) as any[];
  return rows.map(mapRowToActivity);
}

/**
 * Get all activities
 */
export function getAllActivities(): DealActivity[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM deal_activities ORDER BY performed_at DESC').all() as any[];
  return rows.map(mapRowToActivity);
}

/**
 * Update a deal activity
 */
export function updateDealActivity(id: string, data: Partial<DealActivity>): DealActivity | null {
  if (!db) throw new Error('Database not initialized');
  
  const existing = getDealActivity(id);
  if (!existing) return null;
  
  const stmt = db.prepare(`
    UPDATE deal_activities SET
      type = COALESCE(?, type),
      description = COALESCE(?, description),
      performed_by = COALESCE(?, performed_by),
      performed_at = COALESCE(?, performed_at)
    WHERE id = ?
  `);
  
  stmt.run(
    data.type,
    data.description,
    data.performedBy,
    data.performedAt,
    id
  );
  
  return getDealActivity(id);
}

/**
 * Delete a deal activity
 */
export function deleteDealActivity(id: string): boolean {
  if (!db) throw new Error('Database not initialized');
  
  const result = db.prepare('DELETE FROM deal_activities WHERE id = ?').run(id);
  return result.changes > 0;
}

// =============================================================================
// ACTIVITY SOURCE OPERATIONS (Document Citations)
// =============================================================================

/**
 * Add a source/citation to an activity
 */
export function addActivitySource(activityId: string, source: ActivitySource): ActivitySource {
  if (!db) throw new Error('Database not initialized');
  
  const id = generateId();
  
  const stmt = db.prepare(`
    INSERT INTO activity_sources (id, activity_id, file_name, file_path, section, page_number, source, onedrive_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    activityId,
    source.fileName,
    source.filePath,
    source.section || null,
    source.pageNumber || null,
    source.source || null,
    source.oneDriveId || null
  );
  
  return { ...source, id };
}

/**
 * Get all sources for an activity
 */
export function getActivitySources(activityId: string): ActivitySource[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM activity_sources WHERE activity_id = ? ORDER BY created_at').all(activityId) as any[];
  return rows.map(mapRowToSource);
}

/**
 * Remove a source from an activity
 */
export function removeActivitySource(sourceId: string): boolean {
  if (!db) throw new Error('Database not initialized');
  
  const result = db.prepare('DELETE FROM activity_sources WHERE id = ?').run(sourceId);
  return result.changes > 0;
}

/**
 * Get activities with their sources for a deal (for export)
 */
export function getActivitiesWithSources(dealId: string): DealActivity[] {
  if (!db) throw new Error('Database not initialized');
  
  const activities = getActivitiesForDeal(dealId);
  
  // Load sources for each activity
  return activities.map(activity => ({
    ...activity,
    sources: activity.id ? getActivitySources(activity.id) : []
  }));
}

/**
 * Map database row to ActivitySource
 */
function mapRowToSource(row: any): ActivitySource {
  return {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    section: row.section || undefined,
    pageNumber: row.page_number || undefined,
    source: row.source || undefined,
    oneDriveId: row.onedrive_id || undefined
  };
}

// =============================================================================
// PIPELINE ANALYTICS
// =============================================================================

/**
 * Calculate pipeline analytics
 */
export function calculatePipelineAnalytics(): PipelineAnalytics {
  if (!db) throw new Error('Database not initialized');
  
  const stages: DealStage[] = ['lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'];
  
  const byStage: Record<DealStage, { count: number; totalValue: number }> = {} as any;
  let totalDeals = 0;
  let totalPipelineValue = 0;
  
  for (const stage of stages) {
    const result = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(loan_amount), 0) as total
      FROM deals WHERE stage = ?
    `).get(stage) as { count: number; total: number };
    
    byStage[stage] = { count: result.count, totalValue: result.total };
    totalDeals += result.count;
    
    // Pipeline value excludes closed and declined
    if (!['closed', 'declined'].includes(stage)) {
      totalPipelineValue += result.total;
    }
  }
  
  // Average deal size (excluding closed and declined)
  const activeResult = db.prepare(`
    SELECT AVG(loan_amount) as avg
    FROM deals WHERE stage NOT IN ('closed', 'declined') AND loan_amount > 0
  `).get() as { avg: number | null };
  
  const averageDealSize = activeResult.avg || 0;
  
  return {
    totalDeals,
    totalPipelineValue,
    averageDealSize,
    byStage
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function mapRowToDeal(row: any): Deal {
  return {
    id: row.id,
    dealNumber: row.deal_number,
    borrowerName: row.borrower_name,
    borrowerContact: row.borrower_contact,
    loanAmount: row.loan_amount,
    interestRate: row.interest_rate,
    termMonths: row.term_months,
    collateralDescription: row.collateral_description,
    stage: row.stage as DealStage,
    priority: row.priority,
    assignedTo: row.assigned_to,
    documentPath: row.document_path,
    notes: row.notes,
    expectedCloseDate: row.expected_close_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToActivity(row: any): DealActivity {
  const activityId = row.id;
  return {
    id: activityId,
    dealId: row.deal_id,
    type: row.type as DealActivityType,
    description: row.description,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    createdAt: row.created_at,
    sources: activityId ? getActivitySources(activityId) : []
  };
}

// =============================================================================
// CHAT SESSION OPERATIONS
// =============================================================================

/**
 * Create a new chat session
 */
export function createChatSession(data: {
  title?: string;
  dealId?: string;
  dealName?: string;
  sources?: ChatSessionSource[];
  firstMessage?: string;
}): ChatSession {
  if (!db) throw new Error('Database not initialized');
  
  const id = generateId();
  const now = new Date().toISOString();
  const title = data.title || 'New Chat';
  const sources = JSON.stringify(data.sources || []);
  
  const stmt = db.prepare(`
    INSERT INTO chat_sessions (id, title, deal_id, deal_name, sources, message_count, first_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  
  stmt.run(id, title, data.dealId || null, data.dealName || null, sources, data.firstMessage || null, now, now);
  
  return getChatSession(id)!;
}

/**
 * Get a chat session by ID (without messages)
 */
export function getChatSession(id: string): ChatSession | null {
  if (!db) throw new Error('Database not initialized');
  
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as any;
  if (!row) return null;
  
  return mapRowToChatSession(row);
}

/**
 * Get a chat session with all messages
 */
export function getChatSessionFull(id: string): ChatSessionFull | null {
  if (!db) throw new Error('Database not initialized');
  
  const session = getChatSession(id);
  if (!session) return null;
  
  const messages = getChatSessionMessages(id);
  
  return { ...session, messages };
}

/**
 * Get all chat sessions (without messages)
 */
export function getAllChatSessions(): ChatSession[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as any[];
  return rows.map(mapRowToChatSession);
}

/**
 * Update a chat session
 */
export function updateChatSession(id: string, data: Partial<{
  title: string;
  dealId: string | null;
  dealName: string | null;
  sources: ChatSessionSource[];
}>): ChatSession | null {
  if (!db) throw new Error('Database not initialized');
  
  const existing = getChatSession(id);
  if (!existing) return null;
  
  const now = new Date().toISOString();
  const updates: string[] = ['updated_at = ?'];
  const values: any[] = [now];
  
  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.dealId !== undefined) {
    updates.push('deal_id = ?');
    values.push(data.dealId);
  }
  if (data.dealName !== undefined) {
    updates.push('deal_name = ?');
    values.push(data.dealName);
  }
  if (data.sources !== undefined) {
    updates.push('sources = ?');
    values.push(JSON.stringify(data.sources));
  }
  
  values.push(id);
  
  db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  
  return getChatSession(id);
}

/**
 * Delete a chat session and all its messages
 */
export function deleteChatSession(id: string): boolean {
  if (!db) throw new Error('Database not initialized');
  
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Add a message to a chat session
 */
export function addChatMessage(sessionId: string, message: ChatMessage): ChatMessage {
  if (!db) throw new Error('Database not initialized');
  
  const id = message.id || generateId();
  const ragSources = JSON.stringify(message.ragSources || []);
  
  const stmt = db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, timestamp, rag_sources)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, sessionId, message.role, message.content, message.timestamp, ragSources);
  
  // Update session message count and first message if needed
  const session = getChatSession(sessionId);
  if (session) {
    const updateStmt = db.prepare(`
      UPDATE chat_sessions 
      SET message_count = message_count + 1,
          first_message = COALESCE(first_message, ?),
          updated_at = datetime('now')
      WHERE id = ?
    `);
    updateStmt.run(message.role === 'user' ? message.content.slice(0, 100) : null, sessionId);
  }
  
  return { ...message, id };
}

/**
 * Get all messages for a chat session
 */
export function getChatSessionMessages(sessionId: string): ChatMessage[] {
  if (!db) throw new Error('Database not initialized');
  
  const rows = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
  return rows.map(mapRowToChatMessage);
}

/**
 * Generate title from first message using simple extraction
 */
export function generateSessionTitle(firstMessage: string): string {
  // Take first 50 chars, trim, and add ellipsis if needed
  const cleaned = firstMessage.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + '...';
}

// =============================================================================
// CHAT SESSION HELPERS
// =============================================================================

function mapRowToChatSession(row: any): ChatSession {
  return {
    id: row.id,
    title: row.title,
    dealId: row.deal_id,
    dealName: row.deal_name,
    sources: JSON.parse(row.sources || '[]'),
    messageCount: row.message_count,
    firstMessage: row.first_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    ragSources: JSON.parse(row.rag_sources || '[]')
  };
}
