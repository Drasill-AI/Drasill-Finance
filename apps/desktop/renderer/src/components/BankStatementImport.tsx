import { useState, useEffect, useCallback } from 'react';
import { extractPdfText } from '../utils/pdfExtractor';
import styles from './BankStatementImport.module.css';

interface ParsedTransaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance?: number;
  sourcePage?: number;
}

interface ParsedStatement {
  institution: string;
  accountName?: string;
  accountNumberLast4?: string;
  accountType?: string;
  periodStart: string;
  periodEnd: string;
  openingBalance?: number;
  closingBalance?: number;
  transactions: ParsedTransaction[];
}

interface BankAccount {
  id: string;
  dealId?: string;
  institution: string;
  accountName?: string;
  accountNumberLast4?: string;
  accountType: string;
  createdAt?: string;
}

interface BankStatement {
  id: string;
  accountId: string;
  filePath: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  openingBalance?: number;
  closingBalance?: number;
  totalDeposits?: number;
  totalWithdrawals?: number;
  importStatus: string;
  createdAt?: string;
}

interface Props {
  dealId: string;
  dealName: string;
  onClose: () => void;
}

type ImportStep = 'select' | 'parsing' | 'preview' | 'importing' | 'done';

export function BankStatementImport({ dealId, dealName, onClose }: Props) {
  const [step, setStep] = useState<ImportStep>('select');
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedData, setParsedData] = useState<ParsedStatement | null>(null);
  const [importResult, setImportResult] = useState<any>(null);

  // Existing statements
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);

  // Load existing data
  useEffect(() => {
    loadExistingData();
  }, [dealId]);

  const loadExistingData = async () => {
    try {
      const accts = await window.electronAPI.bankGetAccounts(dealId);
      setAccounts(accts);
      const stmts = await window.electronAPI.bankGetStatements(dealId);
      setStatements(stmts);
    } catch (err) {
      console.error('Failed to load bank data:', err);
    }
  };

  const handleSelectFile = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electronAPI.bankSelectFile();
      if (!result) return; // User cancelled

      setFilePath(result.filePath);
      setFileName(result.fileName);
      setStep('parsing');

      // Parse based on file type
      const fileType = result.fileType;
      if (fileType === 'csv') {
        const parseResult = await window.electronAPI.bankParseCSV(result.filePath);
        if (parseResult.success) {
          setParsedData(parseResult.data);
          setStep('preview');
        } else {
          setError(parseResult.error || 'Failed to parse CSV');
          setStep('select');
        }
      } else if (fileType === 'pdf') {
        // Read file as binary, extract text in renderer via pdfjs, then parse via LLM
        try {
          const binary = await window.electronAPI.readFileBinary(result.filePath);
          const extractedText = await extractPdfText(binary.data);
          const parseResult = await window.electronAPI.bankParsePDF(extractedText, result.fileName);
          if (parseResult.success) {
            setParsedData(parseResult.data);
            setStep('preview');
          } else {
            setError(parseResult.error || 'Failed to parse PDF bank statement');
            setStep('select');
          }
        } catch (pdfErr) {
          setError(pdfErr instanceof Error ? pdfErr.message : 'Failed to extract text from PDF');
          setStep('select');
        }
      } else {
        setError('Excel file support coming soon. Please export to CSV from Excel first.');
        setStep('select');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select file');
      setStep('select');
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!parsedData) return;
    
    setStep('importing');
    setError(null);

    try {
      const result = await window.electronAPI.bankImportStatement(dealId, filePath, fileName, parsedData);
      if (result.success) {
        setImportResult(result);
        setStep('done');
        await loadExistingData();
      } else {
        setError(result.error || 'Import failed');
        setStep('preview');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    }
  }, [parsedData, dealId, filePath, fileName]);

  const handleDeleteStatement = useCallback(async (stmtId: string) => {
    try {
      await window.electronAPI.bankDeleteStatement(stmtId);
      await loadExistingData();
    } catch (err) {
      console.error('Failed to delete statement:', err);
    }
  }, []);

  const handleDeleteAccount = useCallback(async (accountId: string) => {
    try {
      await window.electronAPI.bankDeleteAccount(accountId);
      await loadExistingData();
    } catch (err) {
      console.error('Failed to delete account:', err);
    }
  }, []);

  const formatCurrency = (amount: number | undefined) => {
    if (amount === undefined || amount === null) return '—';
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            📊 Bank Statement Import
          </h2>
          <span className={styles.subtitle}>{dealName}</span>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div className={styles.content}>
          {/* Error display */}
          {error && (
            <div className={styles.errorBanner}>
              <span>⚠️</span>
              <span>{error}</span>
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {/* Step: Select File */}
          {step === 'select' && (
            <div className={styles.stepContent}>
              <p className={styles.instructions}>
                Import bank statements to enable AI-powered financial analysis including balance summaries, 
                cashflow trends, and seasonality detection.
              </p>
              <div className={styles.supportedFormats}>
                <span className={styles.formatBadge}>CSV ✓</span>
                <span className={styles.formatBadge}>PDF ✓</span>
                <span className={styles.formatBadge}>Excel (export to CSV)</span>
              </div>
              <button className={styles.selectButton} onClick={handleSelectFile}>
                📁 Select Bank Statement File
              </button>

              {/* Existing imported data */}
              {accounts.length > 0 && (
                <div className={styles.existingData}>
                  <h3 className={styles.sectionTitle}>Imported Accounts</h3>
                  {accounts.map(account => (
                    <div key={account.id} className={styles.accountCard}>
                      <div className={styles.accountInfo}>
                        <span className={styles.institution}>{account.institution}</span>
                        {account.accountNumberLast4 && (
                          <span className={styles.accountNum}>****{account.accountNumberLast4}</span>
                        )}
                        <span className={styles.accountType}>{account.accountType}</span>
                      </div>
                      <button
                        className={styles.deleteButton}
                        onClick={() => handleDeleteAccount(account.id)}
                        title="Delete account and all statements"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {statements.length > 0 && (
                <div className={styles.existingData}>
                  <h3 className={styles.sectionTitle}>
                    Imported Statements ({statements.length})
                  </h3>
                  {statements.map(stmt => (
                    <div key={stmt.id} className={styles.statementCard}>
                      <div className={styles.statementInfo}>
                        <span className={styles.statementFile}>{stmt.fileName}</span>
                        <span className={styles.statementPeriod}>
                          {stmt.periodStart} → {stmt.periodEnd}
                        </span>
                        <div className={styles.statementMeta}>
                          {stmt.totalDeposits !== undefined && (
                            <span className={styles.deposits}>↑ {formatCurrency(stmt.totalDeposits)}</span>
                          )}
                          {stmt.totalWithdrawals !== undefined && (
                            <span className={styles.withdrawals}>↓ {formatCurrency(stmt.totalWithdrawals)}</span>
                          )}
                          <span className={`${styles.statusBadge} ${styles[stmt.importStatus]}`}>
                            {stmt.importStatus}
                          </span>
                        </div>
                      </div>
                      <button
                        className={styles.deleteButton}
                        onClick={() => handleDeleteStatement(stmt.id)}
                        title="Delete statement"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step: Parsing */}
          {step === 'parsing' && (
            <div className={styles.stepContent}>
              <div className={styles.spinnerContainer}>
                <div className={styles.spinner} />
                <p>Parsing {fileName}...</p>
              </div>
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && parsedData && (
            <div className={styles.stepContent}>
              <h3 className={styles.sectionTitle}>Preview: {fileName}</h3>
              
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Institution</span>
                  <span className={styles.summaryValue}>{parsedData.institution}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Period</span>
                  <span className={styles.summaryValue}>{parsedData.periodStart} → {parsedData.periodEnd}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Opening Balance</span>
                  <span className={styles.summaryValue}>{formatCurrency(parsedData.openingBalance)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Closing Balance</span>
                  <span className={styles.summaryValue}>{formatCurrency(parsedData.closingBalance)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Transactions</span>
                  <span className={styles.summaryValue}>{parsedData.transactions.length}</span>
                </div>
              </div>

              <div className={styles.previewTable}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.transactions.slice(0, 20).map((txn, i) => (
                      <tr key={i}>
                        <td>{txn.date}</td>
                        <td className={styles.descCell}>{txn.description}</td>
                        <td className={styles.debitCell}>
                          {txn.debit > 0 ? formatCurrency(txn.debit) : ''}
                        </td>
                        <td className={styles.creditCell}>
                          {txn.credit > 0 ? formatCurrency(txn.credit) : ''}
                        </td>
                        <td>{txn.runningBalance !== undefined ? formatCurrency(txn.runningBalance) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.transactions.length > 20 && (
                  <p className={styles.truncated}>
                    Showing 20 of {parsedData.transactions.length} transactions
                  </p>
                )}
              </div>

              <div className={styles.previewActions}>
                <button className={styles.cancelButton} onClick={() => { setStep('select'); setParsedData(null); }}>
                  Cancel
                </button>
                <button className={styles.importButton} onClick={handleImport}>
                  ✓ Import {parsedData.transactions.length} Transactions
                </button>
              </div>
            </div>
          )}

          {/* Step: Importing */}
          {step === 'importing' && (
            <div className={styles.stepContent}>
              <div className={styles.spinnerContainer}>
                <div className={styles.spinner} />
                <p>Importing transactions...</p>
              </div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && importResult && (
            <div className={styles.stepContent}>
              <div className={styles.successBanner}>
                <span className={styles.successIcon}>✅</span>
                <h3>Import Complete</h3>
                <p>{importResult.transactionCount} transactions imported successfully.</p>
                <p className={styles.hint}>
                  You can now ask the AI questions like:
                </p>
                <ul className={styles.exampleQueries}>
                  <li>"What was the average lowest balance over the last two years?"</li>
                  <li>"Detect any seasonality in the cashflow"</li>
                  <li>"Show me monthly cashflow breakdown"</li>
                  <li>"Find all transactions containing 'rent'"</li>
                </ul>
              </div>
              <div className={styles.previewActions}>
                <button className={styles.importButton} onClick={() => { setStep('select'); setParsedData(null); setImportResult(null); }}>
                  Import Another Statement
                </button>
                <button className={styles.cancelButton} onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
