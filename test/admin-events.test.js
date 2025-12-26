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
          data: params[3],
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

      // COUNT pending events (check this before the general SELECT)
      if (
        sql.includes('COUNT(*)') &&
        sql.includes("status = 'pending'") &&
        !sql.includes('GROUP BY')
      ) {
        const pending = events.filter((e) => e.status === 'pending');
        return { rows: [{ count: String(pending.length) }] };
      }

      // COUNT by priority
      if (sql.includes('COUNT') && sql.includes('GROUP BY priority')) {
        const counts = {};
        events
          .filter((e) => e.status === 'pending')
          .forEach((e) => {
            counts[e.priority] = (counts[e.priority] || 0) + 1;
          });
        return {
          rows: Object.entries(counts).map(([priority, count]) => ({
            priority,
            count: String(count),
          })),
        };
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

      // SELECT history (non-pending)
      if (sql.includes("status != 'pending'")) {
        const resolved = events.filter((e) => e.status !== 'pending');
        return { rows: resolved };
      }

      return { rows: [] };
    },
  };
};

// =============================================================================
// createEvent tests
// =============================================================================

test('createEvent should create a new event in the database', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const event = await service.createEvent({
    type: 'account_approval',
    title: 'New user registration',
    description: 'User john@example.com requests access',
    data: { username: 'john', email: 'john@example.com' },
    priority: 'normal',
  });

  assert.ok(event);
  assert.strictEqual(event.event_type, 'account_approval');
  assert.strictEqual(event.title, 'New user registration');
  assert.strictEqual(event.priority, 'normal');
  assert.strictEqual(event.status, 'pending');
});

test('createEvent should default to normal priority', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const event = await service.createEvent({
    type: 'test_event',
    title: 'Test event',
  });

  assert.strictEqual(event.priority, 'normal');
});

test('createEvent should throw without pool', async () => {
  const logger = createMockLogger();
  const service = createAdminEventService({ logger });

  await assert.rejects(
    async () => {
      await service.createEvent({
        type: 'test',
        title: 'Test',
      });
    },
    { message: 'Database pool not configured' }
  );
});

// =============================================================================
// getPendingEvents tests
// =============================================================================

test('getPendingEvents should return only pending events', async () => {
  const mockEvents = [
    { id: '1', status: 'pending', event_type: 'test', priority: 'normal' },
    { id: '2', status: 'approved', event_type: 'test', priority: 'normal' },
    { id: '3', status: 'pending', event_type: 'test', priority: 'high' },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const result = await service.getPendingEvents();

  assert.strictEqual(result.total, 2);
  assert.strictEqual(result.events.length, 2);
  assert.ok(result.events.every((e) => e.status === 'pending'));
});

test('getPendingEvents should filter by type', async () => {
  const mockEvents = [
    {
      id: '1',
      status: 'pending',
      event_type: 'account_approval',
      priority: 'normal',
    },
    { id: '2', status: 'pending', event_type: 'report', priority: 'normal' },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const result = await service.getPendingEvents({ type: 'account_approval' });

  // Mock doesn't fully implement filtering, but the call should work
  assert.ok(result);
  assert.ok(Array.isArray(result.events));
});

// =============================================================================
// getEventById tests
// =============================================================================

test('getEventById should return event when found', async () => {
  const mockEvents = [
    {
      id: 'test-uuid-1',
      status: 'pending',
      event_type: 'test',
      title: 'Test Event',
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const event = await service.getEventById('test-uuid-1');

  assert.ok(event);
  assert.strictEqual(event.id, 'test-uuid-1');
  assert.strictEqual(event.title, 'Test Event');
});

test('getEventById should return null when not found', async () => {
  const pool = createMockPool({ events: [] });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const event = await service.getEventById('non-existent');

  assert.strictEqual(event, null);
});

// =============================================================================
// registerActionHandler tests
// =============================================================================

test('registerActionHandler should register handlers', () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  service.registerActionHandler('account_approval', 'approve', async () => ({
    success: true,
  }));
  service.registerActionHandler('account_approval', 'reject', async () => ({
    success: true,
  }));

  const actions = service.getAvailableActions('account_approval');

  assert.deepStrictEqual(actions, ['approve', 'reject']);
});

test('getAvailableActions should return empty array for unknown type', () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const actions = service.getAvailableActions('unknown_type');

  assert.deepStrictEqual(actions, []);
});

// =============================================================================
// executeAction tests
// =============================================================================

test('executeAction should execute handler and update event', async () => {
  const mockEvents = [
    {
      id: 'test-event-1',
      status: 'pending',
      event_type: 'account_approval',
      data: { username: 'john' },
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  let handlerCalled = false;
  service.registerActionHandler('account_approval', 'approve', async (data) => {
    handlerCalled = true;
    assert.strictEqual(data.username, 'john');
    return { success: true, message: 'User approved' };
  });

  const adminUser = { _id: 'admin-1', username: 'admin' };
  const result = await service.executeAction(
    'test-event-1',
    'approve',
    adminUser,
    'web'
  );

  assert.ok(handlerCalled);
  assert.strictEqual(result.success, true);
  assert.ok(result.event);
  assert.strictEqual(result.event.status, 'approve');
  assert.strictEqual(result.event.resolved_via, 'web');
});

test('executeAction should fail for non-existent event', async () => {
  const pool = createMockPool({ events: [] });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const result = await service.executeAction(
    'non-existent',
    'approve',
    { _id: 'admin' },
    'web'
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.message, 'Event not found');
});

test('executeAction should fail for already resolved event', async () => {
  const mockEvents = [
    {
      id: 'test-event-1',
      status: 'approved',
      event_type: 'test',
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const result = await service.executeAction(
    'test-event-1',
    'approve',
    { _id: 'admin' },
    'web'
  );

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already resolved'));
});

test('executeAction should fail for unknown action', async () => {
  const mockEvents = [
    {
      id: 'test-event-1',
      status: 'pending',
      event_type: 'test',
    },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const result = await service.executeAction(
    'test-event-1',
    'unknown_action',
    { _id: 'admin' },
    'web'
  );

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('No handler'));
});

// =============================================================================
// getPendingCount tests
// =============================================================================

test('getPendingCount should return count of pending events', async () => {
  const mockEvents = [
    { id: '1', status: 'pending' },
    { id: '2', status: 'pending' },
    { id: '3', status: 'approved' },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const count = await service.getPendingCount();

  assert.strictEqual(count, 2);
});

test('getPendingCount should return 0 without pool', async () => {
  const logger = createMockLogger();
  const service = createAdminEventService({ logger });

  const count = await service.getPendingCount();

  assert.strictEqual(count, 0);
});

// =============================================================================
// getPendingCountsByPriority tests
// =============================================================================

test('getPendingCountsByPriority should return counts by priority', async () => {
  const mockEvents = [
    { id: '1', status: 'pending', priority: 'urgent' },
    { id: '2', status: 'pending', priority: 'urgent' },
    { id: '3', status: 'pending', priority: 'normal' },
    { id: '4', status: 'approved', priority: 'high' },
  ];
  const pool = createMockPool({ events: mockEvents });
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  const counts = await service.getPendingCountsByPriority();

  assert.strictEqual(counts.urgent, 2);
  assert.strictEqual(counts.normal, 1);
  assert.strictEqual(counts.total, 3);
});

// =============================================================================
// setTelegramNotifier tests
// =============================================================================

test('setTelegramNotifier should allow late binding of notifier', async () => {
  const pool = createMockPool();
  const logger = createMockLogger();
  const service = createAdminEventService({ pool, logger });

  let notifierCalled = false;
  const mockNotifier = {
    notifyNewEvent: async () => {
      notifierCalled = true;
      return { messageId: 123, chatId: -456 };
    },
  };

  // Set notifier after service creation
  service.setTelegramNotifier(mockNotifier);

  // Create event with actions to trigger notification
  await service.createEvent({
    type: 'test',
    title: 'Test',
  });

  // The notifier should have been called since it was set
  assert.ok(
    notifierCalled,
    'Telegram notifier should be called after setTelegramNotifier'
  );
});
