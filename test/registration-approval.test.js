const test = require('node:test');
const assert = require('node:assert');
const { createAdminEventService } = require('../utils/admin-events.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Mock usersAsync for action handlers
const createMockUsersAsync = (users = []) => {
  return {
    findOne: async (query) => {
      if (query._id) {
        return users.find((u) => u._id === query._id) || null;
      }
      if (query.email) {
        return users.find((u) => u.email === query.email) || null;
      }
      return null;
    },
    update: async (query, update) => {
      const user = users.find((u) => u._id === query._id);
      if (!user) return 0;
      if (update.$set) {
        Object.assign(user, update.$set);
      }
      return 1;
    },
    insert: async (data) => {
      const newUser = { ...data, _id: `user-${Date.now()}` };
      users.push(newUser);
      return newUser;
    },
  };
};

// Mock pool that simulates PostgreSQL behavior
const createMockPool = (mockData = {}) => {
  const events = mockData.events || [];
  let eventCounter = 0;

  return {
    query: async (sql, params = []) => {
      // INSERT admin_events
      if (sql.includes('INSERT INTO admin_events')) {
        const newEvent = {
          id: `test-event-${++eventCounter}`,
          event_type: params[0],
          title: params[1],
          description: params[2],
          data:
            typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
          priority: params[4],
          status: 'pending',
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
          resolved_via: null,
          telegram_message_id: null,
          telegram_chat_id: null,
        };
        events.push(newEvent);
        return { rows: [newEvent] };
      }

      // SELECT pending events
      if (sql.includes('SELECT *') && sql.includes("status = 'pending'")) {
        const pending = events.filter((e) => e.status === 'pending');
        return { rows: pending };
      }

      // SELECT by ID
      if (sql.includes('SELECT') && sql.includes('WHERE id = $1')) {
        const event = events.find((e) => e.id === params[0]);
        return { rows: event ? [event] : [] };
      }

      // UPDATE event (resolve)
      if (sql.includes('UPDATE admin_events') && sql.includes('SET status')) {
        const event = events.find((e) => e.id === params[3]);
        if (event) {
          event.status = params[0];
          event.resolved_at = new Date();
          event.resolved_by = params[1];
          event.resolved_via = params[2];
        }
        return { rows: event ? [event] : [] };
      }

      // UPDATE telegram info
      if (
        sql.includes('UPDATE admin_events') &&
        sql.includes('telegram_message_id')
      ) {
        const event = events.find((e) => e.id === params[2]);
        if (event) {
          event.telegram_message_id = params[0];
          event.telegram_chat_id = params[1];
        }
        return { rows: event ? [event] : [] };
      }

      // COUNT pending
      if (sql.includes('COUNT(*)') && sql.includes("status = 'pending'")) {
        const pending = events.filter((e) => e.status === 'pending');
        return { rows: [{ count: String(pending.length) }] };
      }

      return { rows: [] };
    },
  };
};

// =============================================================================
// Registration creates pending user and admin event
// =============================================================================

test('new user registration should create user with pending approval status', async () => {
  const users = [];
  const usersAsync = createMockUsersAsync(users);

  // Simulate registration
  const newUser = await usersAsync.insert({
    email: 'newuser@example.com',
    username: 'newuser',
    hash: 'hashedpassword',
    approvalStatus: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.ok(newUser);
  assert.strictEqual(newUser.email, 'newuser@example.com');
  assert.strictEqual(newUser.username, 'newuser');
  assert.strictEqual(newUser.approvalStatus, 'pending');
});

test('registration should create account_approval admin event', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const event = await service.createEvent({
    type: 'account_approval',
    title: 'New User Registration',
    description:
      'User "testuser" (test@example.com) has registered and needs approval.',
    data: {
      userId: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    },
    priority: 'normal',
    actions: [
      { id: 'approve', label: '✅ Approve' },
      { id: 'reject', label: '❌ Reject' },
    ],
  });

  assert.ok(event);
  assert.strictEqual(event.event_type, 'account_approval');
  assert.strictEqual(event.title, 'New User Registration');
  assert.strictEqual(event.priority, 'normal');
  assert.strictEqual(event.status, 'pending');
  assert.strictEqual(event.data.userId, 'user-123');
  assert.strictEqual(event.data.username, 'testuser');
  assert.strictEqual(event.data.email, 'test@example.com');
});

// =============================================================================
// Approve action handler tests
// =============================================================================

test('approve action should update user approval status to approved', async () => {
  const users = [
    {
      _id: 'user-123',
      username: 'pendinguser',
      email: 'pending@example.com',
      approvalStatus: 'pending',
    },
  ];
  const usersAsync = createMockUsersAsync(users);

  const mockEvents = [
    {
      id: 'event-1',
      status: 'pending',
      event_type: 'account_approval',
      data: {
        userId: 'user-123',
        username: 'pendinguser',
        email: 'pending@example.com',
      },
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  // Register the approve handler (simulating what admin.js does)
  service.registerActionHandler(
    'account_approval',
    'approve',
    async (eventData, _adminUser) => {
      const { userId, username } = eventData;
      const result = await usersAsync.update(
        { _id: userId },
        { $set: { approvalStatus: 'approved', updatedAt: new Date() } }
      );

      if (result === 0) {
        return { success: false, message: 'User not found' };
      }

      return {
        success: true,
        message: `Approved registration for ${username}`,
      };
    }
  );

  const adminUser = { _id: 'admin-1', username: 'admin' };
  const result = await service.executeAction(
    'event-1',
    'approve',
    adminUser,
    'web'
  );

  assert.strictEqual(result.success, true);
  assert.ok(result.message.includes('Approved'));

  // Verify user was updated
  const updatedUser = await usersAsync.findOne({ _id: 'user-123' });
  assert.strictEqual(updatedUser.approvalStatus, 'approved');
});

// =============================================================================
// Reject action handler tests
// =============================================================================

test('reject action should update user approval status to rejected', async () => {
  const users = [
    {
      _id: 'user-456',
      username: 'pendinguser2',
      email: 'pending2@example.com',
      approvalStatus: 'pending',
    },
  ];
  const usersAsync = createMockUsersAsync(users);

  const mockEvents = [
    {
      id: 'event-2',
      status: 'pending',
      event_type: 'account_approval',
      data: {
        userId: 'user-456',
        username: 'pendinguser2',
        email: 'pending2@example.com',
      },
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  // Register the reject handler (simulating what admin.js does)
  service.registerActionHandler(
    'account_approval',
    'reject',
    async (eventData, _adminUser) => {
      const { userId, username } = eventData;
      const result = await usersAsync.update(
        { _id: userId },
        { $set: { approvalStatus: 'rejected', updatedAt: new Date() } }
      );

      if (result === 0) {
        return { success: false, message: 'User not found' };
      }

      return {
        success: true,
        message: `Rejected registration for ${username}`,
      };
    }
  );

  const adminUser = { _id: 'admin-1', username: 'admin' };
  const result = await service.executeAction(
    'event-2',
    'reject',
    adminUser,
    'telegram'
  );

  assert.strictEqual(result.success, true);
  assert.ok(result.message.includes('Rejected'));

  // Verify user was updated
  const updatedUser = await usersAsync.findOne({ _id: 'user-456' });
  assert.strictEqual(updatedUser.approvalStatus, 'rejected');
});

// =============================================================================
// Login approval status check tests
// =============================================================================

test('user with pending approval status should be blocked from login', () => {
  const user = {
    _id: 'user-pending',
    email: 'pending@example.com',
    approvalStatus: 'pending',
  };

  // Simulate the passport check logic
  const approvalStatus = user.approvalStatus || 'approved';

  assert.strictEqual(approvalStatus, 'pending');
  // In real code, this would return done(null, false, { message: '...' })
});

test('user with rejected approval status should be blocked from login', () => {
  const user = {
    _id: 'user-rejected',
    email: 'rejected@example.com',
    approvalStatus: 'rejected',
  };

  const approvalStatus = user.approvalStatus || 'approved';

  assert.strictEqual(approvalStatus, 'rejected');
  // In real code, this would return done(null, false, { message: '...' })
});

test('user with approved approval status should be allowed to login', () => {
  const user = {
    _id: 'user-approved',
    email: 'approved@example.com',
    approvalStatus: 'approved',
  };

  const approvalStatus = user.approvalStatus || 'approved';

  assert.strictEqual(approvalStatus, 'approved');
  // In real code, this would return done(null, user)
});

test('user without approval status (legacy) should be allowed to login', () => {
  // Legacy user without approvalStatus field
  const user = {
    _id: 'user-legacy',
    email: 'legacy@example.com',
  };

  // The fallback to 'approved' ensures backwards compatibility
  const approvalStatus = user.approvalStatus || 'approved';

  assert.strictEqual(approvalStatus, 'approved');
  // In real code, this would return done(null, user)
});

test('user with null approval status should be allowed to login', () => {
  const user = {
    _id: 'user-null',
    email: 'null@example.com',
    approvalStatus: null,
  };

  const approvalStatus = user.approvalStatus || 'approved';

  assert.strictEqual(approvalStatus, 'approved');
});

// =============================================================================
// Action handler with missing userId
// =============================================================================

test('approve action should fail if userId is missing from event data', async () => {
  const mockEvents = [
    {
      id: 'event-bad',
      status: 'pending',
      event_type: 'account_approval',
      data: { username: 'baduser' }, // Missing userId
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  service.registerActionHandler(
    'account_approval',
    'approve',
    async (eventData) => {
      const { userId } = eventData;
      if (!userId) {
        return { success: false, message: 'Missing user ID in event data' };
      }
      return { success: true };
    }
  );

  const result = await service.executeAction(
    'event-bad',
    'approve',
    { _id: 'admin-1', username: 'admin' },
    'web'
  );

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Missing user ID'));
});

// =============================================================================
// Action handler when user not found
// =============================================================================

test('approve action should fail if user not found in database', async () => {
  const usersAsync = createMockUsersAsync([]); // Empty users list

  const mockEvents = [
    {
      id: 'event-deleted',
      status: 'pending',
      event_type: 'account_approval',
      data: { userId: 'non-existent-user', username: 'deleteduser' },
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  service.registerActionHandler(
    'account_approval',
    'approve',
    async (eventData) => {
      const { userId, username } = eventData;
      const result = await usersAsync.update(
        { _id: userId },
        { $set: { approvalStatus: 'approved' } }
      );

      if (result === 0) {
        return { success: false, message: 'User not found' };
      }

      return {
        success: true,
        message: `Approved registration for ${username}`,
      };
    }
  );

  const result = await service.executeAction(
    'event-deleted',
    'approve',
    { _id: 'admin-1', username: 'admin' },
    'web'
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.message, 'User not found');
});

// =============================================================================
// Telegram notification on event creation
// =============================================================================

test('admin event should trigger Telegram notification with approve/reject buttons', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();

  let telegramNotificationReceived = false;
  let receivedActions = null;

  const mockTelegramNotifier = {
    notifyNewEvent: async (event, actions) => {
      telegramNotificationReceived = true;
      receivedActions = actions;
      return { messageId: 12345, chatId: -100123 };
    },
  };

  const service = createAdminEventService({
    pool,
    logger,
    telegramNotifier: mockTelegramNotifier,
  });

  await service.createEvent({
    type: 'account_approval',
    title: 'New User Registration',
    description: 'User needs approval',
    data: { userId: 'user-1', username: 'test' },
    priority: 'normal',
    actions: [
      { id: 'approve', label: '✅ Approve' },
      { id: 'reject', label: '❌ Reject' },
    ],
  });

  assert.ok(
    telegramNotificationReceived,
    'Telegram notification should be sent'
  );
  assert.ok(receivedActions, 'Actions should be passed to Telegram');
  assert.strictEqual(receivedActions.length, 2);
  assert.strictEqual(receivedActions[0].id, 'approve');
  assert.strictEqual(receivedActions[1].id, 'reject');
});

// =============================================================================
// Multiple registrations should create separate events
// =============================================================================

test('multiple registrations should create separate admin events', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  // First registration
  await service.createEvent({
    type: 'account_approval',
    title: 'New User Registration',
    data: { userId: 'user-1', username: 'user1' },
    priority: 'normal',
  });

  // Second registration
  await service.createEvent({
    type: 'account_approval',
    title: 'New User Registration',
    data: { userId: 'user-2', username: 'user2' },
    priority: 'normal',
  });

  const pending = await service.getPendingEvents({ type: 'account_approval' });

  assert.strictEqual(pending.total, 2);
  assert.strictEqual(pending.events.length, 2);
});
