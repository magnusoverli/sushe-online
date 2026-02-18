/**
 * AccountTab - Account settings: email, username, role, password, admin request.
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';
import {
  useUpdateEmail,
  useUpdateUsername,
  useChangePassword,
  useRequestAdmin,
} from '@/hooks/useSettings';
import { logout } from '@/services/auth';
import { showToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  sectionStyle,
  sectionTitleStyle,
  fieldRowStyle,
  fieldLabelStyle,
  fieldValueStyle,
  inputStyle,
  buttonStyle,
  buttonDestructiveStyle,
  footerStyle,
} from './shared-styles';

interface AccountTabProps {
  onClose: () => void;
}

export function AccountTab({ onClose }: AccountTabProps) {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);

  // Inline editing state
  const [editingField, setEditingField] = useState<'email' | 'username' | null>(
    null
  );
  const [editValue, setEditValue] = useState('');

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Admin request
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminCode, setAdminCode] = useState('');

  // Logout confirm
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const emailMutation = useUpdateEmail();
  const usernameMutation = useUpdateUsername();
  const passwordMutation = useChangePassword();
  const adminMutation = useRequestAdmin();

  const startEdit = useCallback(
    (field: 'email' | 'username') => {
      setEditingField(field);
      setEditValue(user?.[field] ?? '');
    },
    [user]
  );

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingField || !editValue.trim()) return;
    const mutation =
      editingField === 'email' ? emailMutation : usernameMutation;
    await mutation.mutateAsync(editValue.trim());
    setEditingField(null);
    setEditValue('');
  }, [editingField, editValue, emailMutation, usernameMutation]);

  const handlePasswordChange = useCallback(async () => {
    await passwordMutation.mutateAsync({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    setShowPasswordForm(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [currentPassword, newPassword, confirmPassword, passwordMutation]);

  const handleAdminRequest = useCallback(async () => {
    await adminMutation.mutateAsync(adminCode);
    setShowAdminForm(false);
    setAdminCode('');
  }, [adminCode, adminMutation]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      setUser(null);
      onClose();
      // Force reload to clear all state and redirect to login
      window.location.href = '/mobile/login';
    } catch {
      showToast('Failed to log out', 'error');
    }
  }, [setUser, onClose]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (!user) return null;

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Profile info */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Profile</div>

        {/* Email */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Email</span>
          {editingField === 'email' ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="email"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  padding: '4px 8px',
                  fontSize: '7.5px',
                }}
                onClick={saveEdit}
                disabled={emailMutation.isPending}
              >
                {emailMutation.isPending ? '...' : 'Save'}
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  padding: '4px 8px',
                  fontSize: '7.5px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => startEdit('email')}
              style={{
                ...fieldValueStyle,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'right',
              }}
            >
              {user.email}
            </button>
          )}
        </div>

        {/* Username */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Username</span>
          {editingField === 'username' ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  padding: '4px 8px',
                  fontSize: '7.5px',
                }}
                onClick={saveEdit}
                disabled={usernameMutation.isPending}
              >
                {usernameMutation.isPending ? '...' : 'Save'}
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  padding: '4px 8px',
                  fontSize: '7.5px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => startEdit('username')}
              style={{
                ...fieldValueStyle,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'right',
              }}
            >
              {user.username}
            </button>
          )}
        </div>

        {/* Role */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Role</span>
          <span
            style={{
              ...fieldValueStyle,
              color:
                user.role === 'admin'
                  ? 'var(--color-gold)'
                  : 'rgba(255,255,255,0.50)',
            }}
          >
            {user.role === 'admin' ? 'Administrator' : 'User'}
          </span>
        </div>

        {/* Member since */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Member since</span>
          <span style={fieldValueStyle}>{formatDate(user.createdAt)}</span>
        </div>
      </div>

      {/* Security */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Security</div>

        {showPasswordForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                style={buttonStyle}
                onClick={handlePasswordChange}
                disabled={
                  passwordMutation.isPending ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
              >
                {passwordMutation.isPending ? 'Changing...' : 'Change Password'}
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onClick={() => {
                  setShowPasswordForm(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => setShowPasswordForm(true)}
          >
            Change Password
          </button>
        )}
      </div>

      {/* Admin access */}
      {user.role !== 'admin' && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Admin Access</div>
          {showAdminForm ? (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <input
                type="text"
                placeholder="Admin code"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={handleAdminRequest}
                  disabled={adminMutation.isPending || !adminCode}
                >
                  {adminMutation.isPending ? 'Verifying...' : 'Submit'}
                </button>
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}
                  onClick={() => {
                    setShowAdminForm(false);
                    setAdminCode('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              style={buttonStyle}
              onClick={() => setShowAdminForm(true)}
            >
              Request Admin Access
            </button>
          )}
        </div>
      )}

      {/* Logout */}
      <div style={footerStyle}>
        <button
          type="button"
          style={buttonDestructiveStyle}
          onClick={() => setShowLogoutConfirm(true)}
        >
          Log Out
        </button>
      </div>

      <ConfirmDialog
        open={showLogoutConfirm}
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        title="Log Out"
        message="Are you sure you want to log out?"
        confirmLabel="Log Out"
        destructive
      />
    </div>
  );
}
