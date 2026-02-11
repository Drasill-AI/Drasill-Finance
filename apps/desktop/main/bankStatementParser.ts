/**
 * Bank Statement Parser
 * Extracts structured transaction data from PDF text, CSV, or Excel bank statements.
 * Uses GPT-4o-mini via the Supabase proxy for intelligent parsing of PDF text,
 * and deterministic parsing for CSV files.
 */

import * as fs from 'fs/promises';
import { proxyChatRequest } from './supabase';
import {
  createBankAccount,
  createBankStatement,
  bulkInsertTransactions,
  getBankAccountsByDeal,
  type BankAccount,
} from './database';

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedStatement {
  institution: string;
  accountName?: string;
  accountNumberLast4?: string;
  accountType?: 'checking' | 'savings' | 'money_market' | 'other';
  periodStart: string;  // YYYY-MM-DD
  periodEnd: string;    // YYYY-MM-DD
  openingBalance?: number;
  closingBalance?: number;
  transactions: ParsedTransaction[];
}

export interface ParsedTransaction {
  date: string;         // YYYY-MM-DD
  postDate?: string;    // YYYY-MM-DD
  description: string;
  debit: number;
  credit: number;
  runningBalance?: number;
  category?: string;
  sourcePage?: number;
}

export interface ImportResult {
  success: boolean;
  accountId?: string;
  statementId?: string;
  transactionCount?: number;
  statement?: ParsedStatement;
  error?: string;
}

// =============================================================================
// CSV PARSER
// =============================================================================

/**
 * Parse a CSV bank statement file
 * Attempts to auto-detect column mapping from headers
 */
export async function parseCSVBankStatement(filePath: string): Promise<ParsedStatement> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }
  
  // Parse header row
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  
  // Auto-detect column mappings
  const dateCol = findColumn(headers, ['date', 'transaction date', 'trans date', 'posting date', 'txn date', 'value date']);
  const descCol = findColumn(headers, ['description', 'memo', 'details', 'narrative', 'particulars', 'transaction description', 'payee']);
  const debitCol = findColumn(headers, ['debit', 'withdrawal', 'withdrawals', 'amount debit', 'debit amount', 'payment']);
  const creditCol = findColumn(headers, ['credit', 'deposit', 'deposits', 'amount credit', 'credit amount']);
  const amountCol = findColumn(headers, ['amount', 'transaction amount', 'value']);
  const balanceCol = findColumn(headers, ['balance', 'running balance', 'available balance', 'ledger balance', 'closing balance']);
  const typeCol = findColumn(headers, ['type', 'transaction type', 'dr/cr', 'debit/credit']);
  
  if (dateCol === -1) throw new Error('Could not find date column in CSV headers');
  if (descCol === -1) throw new Error('Could not find description column in CSV headers');
  if (debitCol === -1 && creditCol === -1 && amountCol === -1) {
    throw new Error('Could not find amount/debit/credit columns in CSV headers');
  }
  
  const transactions: ParsedTransaction[] = [];
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';
  
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= Math.max(dateCol, descCol)) continue;
    
    const rawDate = cols[dateCol]?.trim();
    const date = normalizeDate(rawDate);
    if (!date) continue;
    
    if (date < minDate) minDate = date;
    if (date > maxDate) maxDate = date;
    
    const description = cols[descCol]?.trim() || '';
    
    let debit = 0;
    let credit = 0;
    
    if (debitCol !== -1 && creditCol !== -1) {
      debit = Math.abs(parseAmount(cols[debitCol]));
      credit = Math.abs(parseAmount(cols[creditCol]));
    } else if (amountCol !== -1) {
      const amount = parseAmount(cols[amountCol]);
      // Check if there's a type column to determine direction
      if (typeCol !== -1) {
        const type = cols[typeCol]?.trim().toLowerCase() || '';
        if (type === 'debit' || type === 'dr' || type === 'withdrawal') {
          debit = Math.abs(amount);
        } else {
          credit = Math.abs(amount);
        }
      } else {
        // Negative = debit, positive = credit
        if (amount < 0) {
          debit = Math.abs(amount);
        } else {
          credit = amount;
        }
      }
    }
    
    const runningBalance = balanceCol !== -1 ? parseAmount(cols[balanceCol]) : undefined;
    
    transactions.push({
      date,
      description,
      debit,
      credit,
      runningBalance: runningBalance || undefined,
    });
  }
  
  // Derive balances from first/last running balance
  const firstWithBalance = transactions.find(t => t.runningBalance !== undefined);
  const lastWithBalance = [...transactions].reverse().find(t => t.runningBalance !== undefined);
  
  return {
    institution: 'Unknown (CSV Import)',
    periodStart: minDate,
    periodEnd: maxDate,
    openingBalance: firstWithBalance?.runningBalance,
    closingBalance: lastWithBalance?.runningBalance,
    transactions,
  };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

/**
 * Find a column index by trying multiple header name variations
 */
function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  // Fuzzy: check if any header contains any candidate
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a monetary amount string into a number
 */
function parseAmount(str: string | undefined): number {
  if (!str) return 0;
  // Remove currency symbols, spaces, commas
  const cleaned = str.replace(/[$£€¥,\s]/g, '').replace(/\((.+)\)/, '-$1');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalize various date formats to YYYY-MM-DD
 */
function normalizeDate(str: string | undefined): string | null {
  if (!str) return null;
  
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  
  // MM/DD/YYYY or M/D/YYYY
  const usMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  }
  
  // DD/MM/YYYY (try parsing with Date)
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  
  return null;
}

// =============================================================================
// PDF PARSER (LLM-based)
// =============================================================================

/**
 * Parse extracted PDF text into structured bank statement data using GPT-4o-mini
 * The PDF text should already have page markers like "--- Page X ---"
 */
export async function parsePDFBankStatement(extractedText: string, fileName: string): Promise<ParsedStatement> {
  // Build a condensed version for the LLM (first ~8000 chars should cover headers + transactions)
  const textForParsing = extractedText.slice(0, 12000);
  
  const systemPrompt = `You are a bank statement parser. Extract structured transaction data from the provided bank statement text.

Return a JSON object with this exact schema:
{
  "institution": "Bank name",
  "accountName": "Account holder name or null",
  "accountNumberLast4": "Last 4 digits of account number or null",
  "accountType": "checking" | "savings" | "money_market" | "other",
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "openingBalance": number or null,
  "closingBalance": number or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "Transaction description",
      "debit": number (0 if not a debit),
      "credit": number (0 if not a credit),
      "runningBalance": number or null,
      "sourcePage": page_number
    }
  ]
}

Rules:
- All dates must be YYYY-MM-DD format
- Debits/withdrawals go in "debit" field as positive numbers
- Credits/deposits go in "credit" field as positive numbers
- If a transaction is a withdrawal/payment/debit, put the amount in "debit" and set "credit" to 0
- If a transaction is a deposit/credit, put the amount in "credit" and set "debit" to 0
- Track the source page number from "--- Page X ---" markers
- Extract ALL transactions visible in the text
- Return ONLY valid JSON, no markdown or explanation`;

  const response = await proxyChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Parse this bank statement:\n\nFile: ${fileName}\n\n${textForParsing}` },
    ],
    {
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      temperature: 0.1,
    }
  );
  
  if (!response.success || !response.content) {
    throw new Error(`LLM parsing failed: ${response.error || 'No response'}`);
  }
  
  // Extract JSON from response (handle potential markdown wrapping)
  let jsonStr = response.content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    
    // Validate and normalize the parsed data
    return {
      institution: parsed.institution || 'Unknown',
      accountName: parsed.accountName || undefined,
      accountNumberLast4: parsed.accountNumberLast4 || undefined,
      accountType: parsed.accountType || 'checking',
      periodStart: parsed.periodStart || '',
      periodEnd: parsed.periodEnd || '',
      openingBalance: parsed.openingBalance ?? undefined,
      closingBalance: parsed.closingBalance ?? undefined,
      transactions: (parsed.transactions || []).map((t: any) => ({
        date: t.date || '',
        postDate: t.postDate || undefined,
        description: t.description || '',
        debit: Math.abs(t.debit || 0),
        credit: Math.abs(t.credit || 0),
        runningBalance: t.runningBalance ?? undefined,
        category: t.category || undefined,
        sourcePage: t.sourcePage || undefined,
      })),
    };
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${err}`);
  }
}

// =============================================================================
// IMPORT ORCHESTRATOR
// =============================================================================

/**
 * Import a bank statement file (CSV or parsed PDF text) into the database
 * Creates or reuses a bank account, creates a statement record, and bulk-inserts transactions
 */
export async function importBankStatement(
  dealId: string,
  filePath: string,
  fileName: string,
  parsedData: ParsedStatement
): Promise<ImportResult> {
  try {
    // Find or create bank account
    const existingAccounts = getBankAccountsByDeal(dealId);
    let account: BankAccount | undefined;
    
    // Try to match by institution + last4
    if (parsedData.accountNumberLast4) {
      account = existingAccounts.find(
        a => a.institution === parsedData.institution && a.accountNumberLast4 === parsedData.accountNumberLast4
      );
    }
    
    // Try to match by institution alone
    if (!account) {
      account = existingAccounts.find(a => a.institution === parsedData.institution);
    }
    
    // Create new account if no match
    if (!account) {
      account = createBankAccount({
        dealId,
        institution: parsedData.institution,
        accountName: parsedData.accountName,
        accountNumberLast4: parsedData.accountNumberLast4,
        accountType: parsedData.accountType || 'checking',
      });
    }
    
    // Create statement record
    const totalDeposits = parsedData.transactions.reduce((sum, t) => sum + t.credit, 0);
    const totalWithdrawals = parsedData.transactions.reduce((sum, t) => sum + t.debit, 0);
    
    const statement = createBankStatement({
      accountId: account.id,
      filePath,
      fileName,
      periodStart: parsedData.periodStart,
      periodEnd: parsedData.periodEnd,
      openingBalance: parsedData.openingBalance,
      closingBalance: parsedData.closingBalance,
      totalDeposits,
      totalWithdrawals,
      sourcePageCount: Math.max(...parsedData.transactions.map(t => t.sourcePage || 1), 1),
      importStatus: 'parsed',
    });
    
    // Bulk insert transactions
    const txnCount = bulkInsertTransactions(statement.id, parsedData.transactions.map(t => ({
      transactionDate: t.date,
      postDate: t.postDate,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      runningBalance: t.runningBalance,
      category: t.category,
      sourcePage: t.sourcePage,
    })));
    
    console.log(`[BankParser] Imported ${txnCount} transactions for ${parsedData.institution} (${parsedData.periodStart} to ${parsedData.periodEnd})`);
    
    return {
      success: true,
      accountId: account.id,
      statementId: statement.id,
      transactionCount: txnCount,
      statement: parsedData,
    };
  } catch (error) {
    console.error('[BankParser] Import failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown import error',
    };
  }
}
