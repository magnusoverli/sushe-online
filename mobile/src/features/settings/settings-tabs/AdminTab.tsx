/**
 * AdminTab - Admin panel: events, user management, stats.
 *
 * Simplified mobile version focused on the most important admin tasks:
 * - Pending event approvals
 * - User management
 * - Admin stats overview
 */

import { useState, useCallback } from 'react';
import {
  useAdminStats,
  useAdminEvents,
  useExecuteEventAction,
  useMakeAdmin,
  useRevokeAdmin,
  useDeleteUser,
} from '@/hooks/useSettings';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { AdminUserInfo } from '@/lib/types';
import {
  sectionStyle,
  sectionTitleStyle,
  buttonStyle,
  buttonDestructiveStyle,
  fieldRowStyle,
  fieldLabelStyle,
  fieldValueStyle,
} from './shared-styles';

export function AdminTab() {
  const { data: adminStats, isLoading: statsLoading } = useAdminStats();
  const { data: eventsData, isLoading: eventsLoading } = useAdminEvents();
  const eventAction = useExecuteEventAction();
  const makeAdminMutation = useMakeAdmin();
  const revokeAdminMutation = useRevokeAdmin();
  const deleteUserMutation = useDeleteUser();

  const [selectedUser, setSelectedUser] = useState<AdminUserInfo | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    user: AdminUserInfo;
  } | null>(null);

  const handleEventAction = useCallback(
    (eventId: string, action: string) => {
      eventAction.mutate({ eventId, action });
    },
    [eventAction]
  );

  const handleUserAction = useCallback(
    (action: string, user: AdminUserInfo) => {
      setConfirmAction({ action, user });
    },
    []
  );

  const executeUserAction = useCallback(() => {
    if (!confirmAction) return;
    const { action, user } = confirmAction;
    switch (action) {
      case 'make-admin':
        makeAdminMutation.mutate(user._id);
        break;
      case 'revoke-admin':
        revokeAdminMutation.mutate(user._id);
        break;
      case 'delete':
        deleteUserMutation.mutate(user._id);
        break;
    }
    setConfirmAction(null);
    setSelectedUser(null);
  }, [
    confirmAction,
    makeAdminMutation,
    revokeAdminMutation,
    deleteUserMutation,
  ]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Pending events */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Pending Events</div>
        {eventsLoading ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
            }}
          >
            Loading events...
          </div>
        ) : eventsData?.events && eventsData.events.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {eventsData.events.map((event) => (
              <div
                key={event._id}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '8px',
                  padding: '10px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '6px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '8.5px',
                        color: 'rgba(255,255,255,0.75)',
                      }}
                    >
                      {event.type.replace(/_/g, ' ')}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7px',
                        color: 'rgba(255,255,255,0.35)',
                        marginTop: '2px',
                      }}
                    >
                      {formatDate(event.created_at)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '6.5px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background:
                        event.priority === 'high'
                          ? 'rgba(224,92,92,0.15)'
                          : event.priority === 'medium'
                            ? 'rgba(232,200,122,0.15)'
                            : 'rgba(255,255,255,0.05)',
                      color:
                        event.priority === 'high'
                          ? 'var(--color-destructive)'
                          : event.priority === 'medium'
                            ? 'var(--color-gold)'
                            : 'rgba(255,255,255,0.50)',
                    }}
                  >
                    {event.priority}
                  </span>
                </div>

                {/* Event data summary */}
                {event.data &&
                  typeof event.data === 'object' &&
                  typeof (event.data as Record<string, unknown>).username ===
                    'string' && (
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7.5px',
                        color: 'rgba(255,255,255,0.50)',
                        marginBottom: '6px',
                      }}
                    >
                      {String((event.data as Record<string, unknown>).username)}
                      {(event.data as Record<string, unknown>).email
                        ? ` (${String((event.data as Record<string, unknown>).email)})`
                        : ''}
                    </div>
                  )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      padding: '4px 10px',
                      fontSize: '7.5px',
                      background: 'rgba(76,175,80,0.15)',
                      color: '#4CAF50',
                    }}
                    onClick={() => handleEventAction(event._id, 'approve')}
                    disabled={eventAction.isPending}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      padding: '4px 10px',
                      fontSize: '7.5px',
                      background: 'rgba(224,92,92,0.15)',
                      color: 'var(--color-destructive)',
                    }}
                    onClick={() => handleEventAction(event._id, 'reject')}
                    disabled={eventAction.isPending}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
              padding: '8px 0',
            }}
          >
            No pending events
          </div>
        )}
      </div>

      {/* User management */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>User Management</div>
        {statsLoading ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
            }}
          >
            Loading users...
          </div>
        ) : adminStats?.users ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {adminStats.users.map((u) => (
              <button
                key={u._id}
                type="button"
                onClick={() =>
                  setSelectedUser(selectedUser?._id === u._id ? null : u)
                }
                style={{
                  background:
                    selectedUser?._id === u._id
                      ? 'rgba(255,255,255,0.05)'
                      : 'transparent',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <div>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '8.5px',
                        color: 'rgba(255,255,255,0.75)',
                      }}
                    >
                      {u.username}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7px',
                        color: 'rgba(255,255,255,0.30)',
                        marginLeft: '6px',
                      }}
                    >
                      {u.email}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '7px',
                      color:
                        u.role === 'admin'
                          ? 'var(--color-gold)'
                          : 'rgba(255,255,255,0.30)',
                    }}
                  >
                    {u.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                </div>

                {/* Expanded actions */}
                {selectedUser?._id === u._id && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Lists</span>
                      <span style={fieldValueStyle}>{u.listCount}</span>
                    </div>
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Last active</span>
                      <span style={fieldValueStyle}>
                        {formatDate(u.lastActivity)}
                      </span>
                    </div>
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Joined</span>
                      <span style={fieldValueStyle}>
                        {formatDate(u.createdAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '6px',
                        marginTop: '8px',
                      }}
                    >
                      {u.role === 'admin' ? (
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: '4px 10px',
                            fontSize: '7.5px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUserAction('revoke-admin', u);
                          }}
                        >
                          Revoke Admin
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: '4px 10px',
                            fontSize: '7.5px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUserAction('make-admin', u);
                          }}
                        >
                          Make Admin
                        </button>
                      )}
                      <button
                        type="button"
                        style={{
                          ...buttonDestructiveStyle,
                          padding: '4px 10px',
                          fontSize: '7.5px',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUserAction('delete', u);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onConfirm={executeUserAction}
        onCancel={() => setConfirmAction(null)}
        title={
          confirmAction?.action === 'delete'
            ? 'Delete User'
            : confirmAction?.action === 'make-admin'
              ? 'Grant Admin'
              : 'Revoke Admin'
        }
        message={
          confirmAction?.action === 'delete'
            ? `Delete user "${confirmAction.user.username}" and all their data? This cannot be undone.`
            : confirmAction?.action === 'make-admin'
              ? `Grant admin privileges to "${confirmAction?.user.username}"?`
              : `Revoke admin privileges from "${confirmAction?.user.username}"?`
        }
        confirmLabel={confirmAction?.action === 'delete' ? 'Delete' : 'Confirm'}
        destructive={confirmAction?.action === 'delete'}
      />
    </div>
  );
}
