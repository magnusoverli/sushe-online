import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterPage } from '../RegisterPage';

// ── Mocks ──

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const mockRegister = vi.fn();
const mockInitCsrf = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/auth', () => ({
  register: (...args: unknown[]) => mockRegister(...args),
  initCsrf: () => mockInitCsrf(),
}));

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the registration form with all fields', () => {
    render(<RegisterPage />);

    expect(
      screen.getByRole('heading', { name: 'Create Account' })
    ).toBeInTheDocument();
    expect(screen.getByText('Get started')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create account/i })
    ).toBeInTheDocument();
  });

  it('initializes CSRF token on mount', () => {
    render(<RegisterPage />);
    expect(mockInitCsrf).toHaveBeenCalledTimes(1);
  });

  it('shows link to login page', () => {
    render(<RegisterPage />);

    const link = screen.getByText('Sign in');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  // ── Client-side validation ──

  it('shows validation errors when all fields are empty', async () => {
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeInTheDocument();
      expect(screen.getByText('Email is required.')).toBeInTheDocument();
      expect(screen.getByText('Password is required.')).toBeInTheDocument();
      expect(
        screen.getByText('Please confirm your password.')
      ).toBeInTheDocument();
    });

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validates username minimum length', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'A' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Name must be at least 2 characters.')
      ).toBeInTheDocument();
    });
  });

  it('validates email format', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Please enter a valid email address.')
      ).toBeInTheDocument();
    });
  });

  it('validates password minimum length', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Password must be at least 6 characters.')
      ).toBeInTheDocument();
    });
  });

  it('validates passwords match', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'different' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  it('clears field error when user types in the field', async () => {
    render(<RegisterPage />);

    // Trigger validation
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeInTheDocument();
    });

    // Start typing — error should disappear
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'John' },
    });

    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument();
  });

  // ── Successful registration ──

  it('calls register service and shows success state', async () => {
    mockRegister.mockResolvedValue({
      success: true,
      message: 'Registration successful!',
    });

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });
    });

    // Success state
    await waitFor(() => {
      expect(screen.getByText('Awaiting Approval')).toBeInTheDocument();
      expect(screen.getByText(/pending admin approval/)).toBeInTheDocument();
    });

    // Back to sign in link present
    const link = screen.getByText('Back to Sign In');
    expect(link).toHaveAttribute('href', '/login');
  });

  it('trims whitespace from username and email', async () => {
    mockRegister.mockResolvedValue({ success: true, message: 'ok' });

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Spaced User  ' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  test@example.com  ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'Spaced User',
          email: 'test@example.com',
        })
      );
    });
  });

  // ── Server errors ──

  it('shows server error on registration failure', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'));

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Email already registered')).toBeInTheDocument();
    });

    // Should still be on the form, not the success state
    expect(screen.queryByText('Awaiting Approval')).not.toBeInTheDocument();
  });

  it('shows generic error for non-Error rejection', async () => {
    mockRegister.mockRejectedValue('unknown');

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Registration failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  // ── Loading state ──

  it('disables submit button while submitting', async () => {
    let resolveRegister: (value: unknown) => void;
    mockRegister.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve;
      })
    );

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Creating Account...')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /creating account/i })
    ).toBeDisabled();

    // Resolve to clean up
    resolveRegister!({ success: true, message: 'ok' });
  });
});
