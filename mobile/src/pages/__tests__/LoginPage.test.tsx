import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

// ── Mocks ──

const mockNavigate = vi.fn();
const mockSetUser = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
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

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('@/stores/app-store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setUser: mockSetUser }),
}));

const mockLogin = vi.fn();
const mockInitCsrf = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/auth', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  initCsrf: () => mockInitCsrf(),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form with all fields', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('heading', { name: 'Sign In' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Remember me')).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('initializes CSRF token on mount', () => {
    render(<LoginPage />);
    expect(mockInitCsrf).toHaveBeenCalledTimes(1);
  });

  it('shows link to registration page', () => {
    render(<LoginPage />);

    const link = screen.getByText('Create one');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/register');
  });

  it('shows validation error when fields are empty', async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Email and password are required.')
      ).toBeInTheDocument();
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls login service with form data on submit', async () => {
    const mockUser = {
      _id: '1',
      email: 'test@example.com',
      username: 'tester',
      role: 'user',
    };
    mockLogin.mockResolvedValue({
      success: true,
      user: mockUser,
      csrfToken: 'new-token',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        remember: false,
      });
    });

    expect(mockSetUser).toHaveBeenCalledWith(mockUser);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['auth', 'session'],
    });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('sends remember=true when checkbox is checked', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { _id: '1', email: 'a@b.com', username: 'u', role: 'user' },
      csrfToken: 'tok',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'pass123' },
    });
    fireEvent.click(screen.getByText('Remember me'));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(
        expect.objectContaining({ remember: true })
      );
    });
  });

  it('displays server error message on login failure', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'bad@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrongpass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows generic error for non-Error rejection', async () => {
    mockLogin.mockRejectedValue('unknown error');

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Login failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('disables submit button while submitting', async () => {
    let resolveLogin: (value: unknown) => void;
    mockLogin.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Signing in...')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

    // Resolve to clean up
    resolveLogin!({
      success: true,
      user: { _id: '1', email: 'a@b.com', username: 'u', role: 'user' },
      csrfToken: 't',
    });
  });

  it('toggles remember me checkbox with keyboard', () => {
    render(<LoginPage />);

    const checkboxContainer = screen.getByRole('checkbox');
    expect(checkboxContainer).toHaveAttribute('aria-checked', 'false');

    fireEvent.keyDown(checkboxContainer, { key: ' ' });
    expect(checkboxContainer).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(checkboxContainer, { key: 'Enter' });
    expect(checkboxContainer).toHaveAttribute('aria-checked', 'false');
  });

  it('has forgot password link pointing to existing flow', () => {
    render(<LoginPage />);

    const link = screen.getByText('Forgot password?');
    expect(link).toHaveAttribute('href', '/forgot-password');
  });
});
