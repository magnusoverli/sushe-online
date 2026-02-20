/**
 * SettingsDrawer - Full-width slide-over from the right.
 *
 * Features horizontal scrolling tab navigation across the top
 * (Account, Integrations, Visual, Stats, Admin) and
 * context-specific content below.
 *
 * Admin tab is only visible to users with role === 'admin'.
 */

import {
  type CSSProperties,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { Scrim } from '@/components/ui/Scrim';
import { AboutSheet } from '@/components/ui/AboutSheet';
import { useAppStore } from '@/stores/app-store';
import type { SettingsCategory } from '@/lib/types';
import { AccountTab } from './settings-tabs/AccountTab';
import { IntegrationsTab } from './settings-tabs/IntegrationsTab';
import { VisualTab } from './settings-tabs/VisualTab';
import { StatsTab } from './settings-tabs/StatsTab';
import { PreferencesTab } from './settings-tabs/PreferencesTab';
import { AdminTab } from './settings-tabs/AdminTab';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SWIPE_CLOSE_THRESHOLD = 60;

const drawerEasing: [number, number, number, number] = [0.32, 0.72, 0, 1];

/**
 * The drawer covers the full screen but its content stops above the TabBar.
 * The TabBar itself is raised to z-index 250 so it paints on top of the drawer,
 * avoiding sub-pixel gaps from CSS calc mismatches.
 */
const TABBAR_CLEARANCE =
  'calc(var(--tabbar-height) + env(safe-area-inset-bottom, 0px))';

const drawerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  background: 'var(--color-bg)',
  zIndex: 'var(--z-drawer)' as unknown as number,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  paddingBottom: TABBAR_CLEARANCE,
};

const TABS: { key: SettingsCategory; label: string; adminOnly?: boolean }[] = [
  { key: 'account', label: 'Account' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'visual', label: 'Visual' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'stats', label: 'Stats' },
  { key: 'admin', label: 'Admin', adminOnly: true },
];

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState<SettingsCategory>('account');
  const [showAbout, setShowAbout] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showFadeLeft, setShowFadeLeft] = useState(false);
  const [showFadeRight, setShowFadeRight] = useState(false);

  // Update tab bar fade indicators based on scroll position
  const updateFades = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const threshold = 4;
    setShowFadeLeft(el.scrollLeft > threshold);
    setShowFadeRight(
      el.scrollLeft + el.clientWidth < el.scrollWidth - threshold
    );
  }, []);

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const el = tabsRef.current;
    if (!el) return;
    // Scroll by roughly one tab width
    const amount = el.clientWidth * 0.6;
    el.scrollBy({
      left: direction === 'right' ? amount : -amount,
      behavior: 'smooth',
    });
  }, []);

  // Reset to account tab when opening and check initial fade state
  useEffect(() => {
    if (open) {
      setActiveTab('account');
      // Defer so the DOM has rendered the tabs
      requestAnimationFrame(updateFades);
    }
  }, [open, updateFades]);

  // Lock background scroll when drawer is open (including iOS rubber-band bounce)
  useEffect(() => {
    if (!open) return;
    const scrollContainer = document.querySelector(
      '[data-testid="app-shell-content"]'
    ) as HTMLElement | null;
    if (scrollContainer) {
      scrollContainer.style.overflowY = 'hidden';
    }
    document.body.style.overflow = 'hidden';
    return () => {
      if (scrollContainer) {
        scrollContainer.style.overflowY = 'auto';
      }
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.x > SWIPE_CLOSE_THRESHOLD) {
        onClose();
      }
    },
    [onClose]
  );

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  const renderTab = () => {
    switch (activeTab) {
      case 'account':
        return <AccountTab onClose={onClose} />;
      case 'integrations':
        return <IntegrationsTab />;
      case 'visual':
        return <VisualTab />;
      case 'preferences':
        return <PreferencesTab />;
      case 'stats':
        return <StatsTab />;
      case 'admin':
        return isAdmin ? <AdminTab /> : null;
      default:
        return null;
    }
  };

  return (
    <>
      <Scrim visible={open} onDismiss={onClose} zIndex={199} />
      <AboutSheet open={showAbout} onClose={() => setShowAbout(false)} />
      <AnimatePresence>
        {open && (
          <motion.div
            style={drawerStyle}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{
              type: 'tween',
              duration: 0.3,
              ease: drawerEasing,
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
            data-testid="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            {/* Header */}
            <div
              style={{
                padding: 'calc(14px + env(safe-area-inset-top, 0px)) 18px 0',
                borderBottom: '1px solid var(--color-divider)',
              }}
            >
              {/* Top bar with close button */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '17px',
                    color: 'var(--color-text-primary)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Settings
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <button
                    type="button"
                    onClick={() => setShowAbout(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,255,255,0.30)',
                      cursor: 'pointer',
                      padding: '10px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    aria-label="About"
                    data-testid="settings-about"
                  >
                    <Info size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,255,255,0.45)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      padding: '10px 12px',
                    }}
                    data-testid="settings-close"
                  >
                    Done
                  </button>
                </div>
              </div>

              {/* Tab bar with chevron scroll indicators */}
              <div style={{ position: 'relative' }}>
                <div
                  ref={tabsRef}
                  className="hide-scrollbar"
                  onScroll={updateFades}
                  style={{
                    display: 'flex',
                    gap: '6px',
                    overflowX: 'auto',
                    paddingBottom: '0',
                    paddingLeft: showFadeLeft ? '24px' : '0',
                    paddingRight: showFadeRight ? '24px' : '0',
                    transition:
                      'padding-left 200ms ease, padding-right 200ms ease',
                  }}
                >
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom:
                          activeTab === tab.key
                            ? '2px solid var(--color-gold)'
                            : '2px solid transparent',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color:
                          activeTab === tab.key
                            ? 'var(--color-gold)'
                            : 'rgba(255,255,255,0.35)',
                        padding: '12px 12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'color 150ms ease',
                      }}
                      data-testid={`settings-tab-${tab.key}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Left chevron */}
                {showFadeLeft && (
                  <button
                    type="button"
                    onClick={() => scrollTabs('left')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-bg)',
                      border: 'none',
                      borderRight: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      padding: 0,
                    }}
                    aria-label="Scroll tabs left"
                  >
                    <ChevronLeft size={14} />
                  </button>
                )}
                {/* Right chevron */}
                {showFadeRight && (
                  <button
                    type="button"
                    onClick={() => scrollTabs('right')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      width: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-bg)',
                      border: 'none',
                      borderLeft: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      padding: 0,
                    }}
                    aria-label="Scroll tabs right"
                  >
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Tab content */}
            <div
              className="hide-scrollbar"
              style={{
                flex: 1,
                overflowY: 'auto',
                minHeight: 0,
                paddingBottom: '16px',
              }}
            >
              {renderTab()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
