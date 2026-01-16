import { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { Deal, DealStage, DealPriority } from '@drasill/shared';
import styles from './DealModal.module.css';

const DEAL_STAGES: { value: DealStage; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'application', label: 'Application' },
  { value: 'underwriting', label: 'Underwriting' },
  { value: 'approved', label: 'Approved' },
  { value: 'funded', label: 'Funded' },
  { value: 'closed', label: 'Closed' },
  { value: 'declined', label: 'Declined' },
];

const DEAL_PRIORITIES: { value: DealPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function DealModal() {
  const { 
    isDealModalOpen, 
    setDealModalOpen, 
    showToast,
    loadDeals,
  } = useAppStore();

  const [formData, setFormData] = useState({
    borrowerName: '',
    borrowerContact: '',
    loanAmount: '',
    interestRate: '',
    termMonths: '',
    collateralDescription: '',
    stage: 'lead' as DealStage,
    priority: 'medium' as DealPriority,
    assignedTo: '',
    expectedCloseDate: '',
    notes: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isDealModalOpen) {
      setFormData({
        borrowerName: '',
        borrowerContact: '',
        loanAmount: '',
        interestRate: '',
        termMonths: '',
        collateralDescription: '',
        stage: 'lead',
        priority: 'medium',
        assignedTo: '',
        expectedCloseDate: '',
        notes: '',
      });
    }
  }, [isDealModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.borrowerName || !formData.loanAmount) {
      showToast('error', 'Please fill in borrower name and loan amount');
      return;
    }

    setIsSubmitting(true);
    try {
      const deal: Omit<Deal, 'id' | 'dealNumber' | 'createdAt' | 'updatedAt'> = {
        borrowerName: formData.borrowerName,
        borrowerContact: formData.borrowerContact || null,
        loanAmount: parseFloat(formData.loanAmount) || 0,
        interestRate: formData.interestRate ? parseFloat(formData.interestRate) : null,
        termMonths: formData.termMonths ? parseInt(formData.termMonths) : null,
        collateralDescription: formData.collateralDescription || null,
        stage: formData.stage,
        priority: formData.priority,
        assignedTo: formData.assignedTo || null,
        documentPath: null,
        notes: formData.notes || null,
        expectedCloseDate: formData.expectedCloseDate || null,
        actualCloseDate: null,
      };

      await window.electronAPI.addDeal(deal);
      showToast('success', 'Deal added successfully');
      setDealModalOpen(false);
      loadDeals();
    } catch (error) {
      showToast('error', 'Failed to add deal');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isDealModalOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => setDealModalOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Add New Deal
          </span>
          <button className={styles.closeButton} onClick={() => setDealModalOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className={styles.content} onSubmit={handleSubmit}>
          <div className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Borrower Name <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                className={styles.input}
                value={formData.borrowerName}
                onChange={(e) => setFormData(prev => ({ ...prev, borrowerName: e.target.value }))}
                placeholder="e.g., Acme Corporation"
                required
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Loan Amount <span className={styles.required}>*</span>
                </label>
                <input
                  type="number"
                  className={styles.input}
                  value={formData.loanAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, loanAmount: e.target.value }))}
                  placeholder="e.g., 500000"
                  min="0"
                  step="1000"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Interest Rate (%)</label>
                <input
                  type="number"
                  className={styles.input}
                  value={formData.interestRate}
                  onChange={(e) => setFormData(prev => ({ ...prev, interestRate: e.target.value }))}
                  placeholder="e.g., 7.5"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Term (months)</label>
                <input
                  type="number"
                  className={styles.input}
                  value={formData.termMonths}
                  onChange={(e) => setFormData(prev => ({ ...prev, termMonths: e.target.value }))}
                  placeholder="e.g., 60"
                  min="1"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Expected Close Date</label>
                <input
                  type="date"
                  className={styles.input}
                  value={formData.expectedCloseDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, expectedCloseDate: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Stage</label>
                <select
                  className={styles.select}
                  value={formData.stage}
                  onChange={(e) => setFormData(prev => ({ ...prev, stage: e.target.value as DealStage }))}
                >
                  {DEAL_STAGES.map(stage => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Priority</label>
                <select
                  className={styles.select}
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as DealPriority }))}
                >
                  {DEAL_PRIORITIES.map(priority => (
                    <option key={priority.value} value={priority.value}>{priority.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Borrower Contact</label>
                <input
                  type="text"
                  className={styles.input}
                  value={formData.borrowerContact}
                  onChange={(e) => setFormData(prev => ({ ...prev, borrowerContact: e.target.value }))}
                  placeholder="e.g., john@acme.com"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Assigned To</label>
                <input
                  type="text"
                  className={styles.input}
                  value={formData.assignedTo}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignedTo: e.target.value }))}
                  placeholder="e.g., Jane Smith"
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Collateral Description</label>
              <input
                type="text"
                className={styles.input}
                value={formData.collateralDescription}
                onChange={(e) => setFormData(prev => ({ ...prev, collateralDescription: e.target.value }))}
                placeholder="e.g., Commercial real estate at 123 Main St"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Notes</label>
              <textarea
                className={styles.textarea}
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes about this deal..."
              />
            </div>
          </div>

          <div className={styles.footer}>
            <button 
              type="button" 
              className={styles.cancelButton}
              onClick={() => setDealModalOpen(false)}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={styles.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Adding...' : 'Add Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
