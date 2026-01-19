import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store';
import { DealActivity, PipelineAnalytics } from '@drasill/shared';
import styles from './BottomPanel.module.css';

interface BottomPanelProps {
  height: number;
  onHeightChange: (height: number) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  document: 'Document',
  meeting: 'Meeting',
};

export function BottomPanel({ height, onHeightChange, isOpen, onToggle }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<'activities' | 'pipeline'>('activities');
  const [selectedDealId, setSelectedDealId] = useState<string | 'all'>('all');
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [analytics, setAnalytics] = useState<PipelineAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  
  const { deals, showToast, setActivityModalOpen, setEditingActivity, activitiesRefreshTrigger, loadDeals } = useAppStore();

  // Load data when panel opens or deal selection changes
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, selectedDealId, activeTab, activitiesRefreshTrigger]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'activities') {
        const activitiesData = selectedDealId === 'all'
          ? await window.electronAPI.getDealActivities(undefined, 100)
          : await window.electronAPI.getDealActivities(selectedDealId, 100);
        setActivities(activitiesData);
      } else {
        const analyticsData = await window.electronAPI.getPipelineAnalytics();
        setAnalytics(analyticsData);
      }
    } catch (error) {
      showToast('error', 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(500, startHeight + delta));
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [height, onHeightChange]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleImportCSV = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importDealsFromCSV();
      if (result.imported > 0) {
        showToast('success', `Successfully imported ${result.imported} deal${result.imported > 1 ? 's' : ''}`);
        loadDeals();
        loadData();
      } else if (result.errors.length > 0) {
        showToast('error', result.errors[0]);
      }
      // Log any errors to console for debugging
      if (result.errors.length > 0) {
        console.warn('CSV Import errors:', result.errors);
      }
    } catch (error) {
      showToast('error', 'Failed to import CSV file');
    } finally {
      setIsImporting(false);
    }
  };

  const getDealName = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    return deal ? deal.borrowerName : `Deal #${dealId}`;
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStageColor = (stage: string): string => {
    const colors: Record<string, string> = {
      lead: '#6b7280',
      application: '#3b82f6',
      underwriting: '#f59e0b',
      approved: '#10b981',
      funded: '#8b5cf6',
      closed: '#6b7280',
      declined: '#ef4444',
    };
    return colors[stage] || '#6b7280';
  };

  return (
    <div 
      className={`${styles.bottomPanelContainer} ${!isOpen ? styles.collapsed : ''}`}
      style={{ height: isOpen ? height : 32 }}
    >
      {/* Resize Handle */}
      {isOpen && (
        <div 
          className={styles.resizeHandleHorizontal}
          onMouseDown={handleDragStart}
        />
      )}

      {/* Header with Tabs */}
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'activities' ? styles.active : ''}`}
            onClick={() => setActiveTab('activities')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Activities
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'pipeline' ? styles.active : ''}`}
            onClick={() => setActiveTab('pipeline')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Pipeline
          </button>
        </div>

        <div className={styles.headerActions}>
          <button 
            className={styles.iconButton}
            onClick={loadData}
            title="Refresh"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button 
            className={styles.iconButton}
            onClick={onToggle}
            title={isOpen ? 'Collapse' : 'Expand'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isOpen ? (
                <polyline points="6 9 12 15 18 9" />
              ) : (
                <polyline points="18 15 12 9 6 15" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {isOpen && (
        <div className={styles.content}>
          {activeTab === 'activities' ? (
            <div className={styles.logsView}>
              <div className={styles.logsToolbar}>
                <select 
                  className={styles.equipmentSelect}
                  value={selectedDealId}
                  onChange={(e) => setSelectedDealId(e.target.value === 'all' ? 'all' : e.target.value)}
                >
                  <option value="all">All Deals</option>
                  {deals.map(deal => (
                    <option key={deal.id} value={deal.id}>
                      {deal.borrowerName} - {formatCurrency(deal.loanAmount)}
                    </option>
                  ))}
                </select>
                <button 
                  className={styles.addButton}
                  onClick={() => setActivityModalOpen(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Activity
                </button>
              </div>

              <div className={styles.logsList}>
                {isLoading ? (
                  <div className={styles.emptyState}>
                    <p>Loading activities...</p>
                  </div>
                ) : activities.length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <p>No activities yet</p>
                    <p>Click "Add Activity" to log deal activities</p>
                  </div>
                ) : (
                  activities.map(activity => (
                    <div 
                      key={activity.id} 
                      className={styles.logEntry}
                      onClick={() => {
                        setEditingActivity(activity);
                        setActivityModalOpen(true);
                      }}
                      style={{ cursor: 'pointer' }}
                      title="Click to edit"
                    >
                      <span className={styles.logDate}>{formatDateTime(activity.performedAt)}</span>
                      <span className={`${styles.logType} ${styles[activity.type]}`}>
                        {ACTIVITY_TYPE_LABELS[activity.type] || activity.type}
                      </span>
                      <span className={styles.logDescription}>{activity.description || 'No description'}</span>
                      <span className={styles.logPerformedBy}>{activity.performedBy || '-'}</span>
                      <span className={styles.logEquipment}>{getDealName(activity.dealId)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className={styles.analyticsView}>
              <div className={styles.analyticsToolbar}>
                <button 
                  className={styles.addButton}
                  onClick={handleImportCSV}
                  disabled={isImporting}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {isImporting ? 'Importing...' : 'Import CSV'}
                </button>
              </div>
              <div className={styles.analyticsGrid}>
                {isLoading ? (
                  <div className={styles.emptyState}>
                    <p>Loading pipeline...</p>
                  </div>
                ) : !analytics ? (
                  <div className={styles.emptyState}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                    <p>No pipeline data available</p>
                    <p>Add deals to see pipeline metrics</p>
                  </div>
                ) : (
                  <>
                    {/* Summary Cards */}
                    <div className={styles.metricCard}>
                      <div className={styles.metricHeader}>
                        <span className={styles.metricName}>Total Pipeline</span>
                        <span className={`${styles.healthBadge} ${styles.good}`}>
                          {analytics.totalDeals} deals
                        </span>
                      </div>
                      <div className={styles.metricValues}>
                        <div className={styles.metricItem}>
                          <span className={styles.metricLabel}>Total Value</span>
                          <span className={`${styles.metricValue} ${styles.accent}`}>
                            {formatCurrency(analytics.totalPipelineValue)}
                          </span>
                        </div>
                        <div className={styles.metricItem}>
                          <span className={styles.metricLabel}>Avg Deal Size</span>
                          <span className={styles.metricValue}>
                            {formatCurrency(analytics.averageDealSize)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stage Breakdown */}
                    {analytics.dealsByStage && Object.keys(analytics.dealsByStage).length > 0 && (
                      <div className={styles.metricCard}>
                        <div className={styles.metricHeader}>
                          <span className={styles.metricName}>Deals by Stage</span>
                        </div>
                        <div className={styles.stageBreakdown}>
                          {Object.entries(analytics.dealsByStage).map(([stage, count]) => (
                            <div key={stage} className={styles.stageItem}>
                              <span 
                                className={styles.stageDot}
                                style={{ backgroundColor: getStageColor(stage) }}
                              />
                              <span className={styles.stageName}>{stage}</span>
                              <span className={styles.stageCount}>{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Value by Stage */}
                    {analytics.valueByStage && Object.keys(analytics.valueByStage).length > 0 && (
                      <div className={styles.metricCard}>
                        <div className={styles.metricHeader}>
                          <span className={styles.metricName}>Value by Stage</span>
                        </div>
                        <div className={styles.stageBreakdown}>
                          {Object.entries(analytics.valueByStage).map(([stage, value]) => (
                            <div key={stage} className={styles.stageItem}>
                              <span 
                                className={styles.stageDot}
                                style={{ backgroundColor: getStageColor(stage) }}
                              />
                              <span className={styles.stageName}>{stage}</span>
                              <span className={styles.stageValue}>{formatCurrency(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
