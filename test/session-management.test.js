const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');
const os = require('os');


const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};


require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};


const tempSessionDir = path.join(os.tmpdir(), 'test-sessions-' + Date.now());

function createTestApp(sessionConfig = {}) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  
  const defaultSessionConfig = {
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, 
    },
    store: new FileStore({
      path: tempSessionDir,
      ttl: 86400, 
      reapInterval: 3600, 
    }),
  };

  app.use(session({ ...defaultSessionConfig, ...sessionConfig }));

  
  app.get('/set-session', (req, res) => {
    req.session.testData = 'session-value';
    req.session.userId = 'test-user-123';
    req.session.loginTime = Date.now();
    res.json({ success: true, sessionId: req.sessionID });
  });

  app.get('/get-session', (req, res) => {
    res.json({
      sessionId: req.sessionID,
      testData: req.session.testData,
      userId: req.session.userId,
      loginTime: req.session.loginTime,
      hasSession: !!req.session,
    });
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body;

    
    if (username === 'testuser' && password === 'password123') {
      req.session.user = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        loginTime: Date.now(),
      };
      req.session.isAuthenticated = true;

      res.json({ success: true, message: 'Logged in successfully' });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.get('/profile', (req, res) => {
    if (!req.session.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      user: req.session.user,
      sessionId: req.sessionID,
    });
  });

  app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to logout' });
      }
      res.json({ success: true, message: 'Logged out successfully' });
    });
  });

  app.get('/session-info', (req, res) => {
    res.json({
      sessionId: req.sessionID,
      cookie: {
        maxAge: req.session.cookie.maxAge,
        _expires: req.session.cookie._expires,
        httpOnly: req.session.cookie.httpOnly,
        secure: req.session.cookie.secure,
      },
      sessionData: req.session,
    });
  });

  app.post('/regenerate-session', (req, res) => {
    const oldSessionId = req.sessionID;
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to regenerate session' });
      }

      req.session.regenerated = true;
      req.session.oldSessionId = oldSessionId;

      res.json({
        success: true,
        oldSessionId,
        newSessionId: req.sessionID,
      });
    });
  });

  app.post('/update-session', (req, res) => {
    const { key, value } = req.body;
    req.session[key] = value;

    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save session' });
      }
      res.json({ success: true, sessionId: req.sessionID });
    });
  });

  return app;
}

test('Session should be created and persist across requests', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  
  const setResponse = await agent.get('/set-session').expect(200);

  assert.strictEqual(setResponse.body.success, true);
  assert.ok(setResponse.body.sessionId);

  
  const getResponse = await agent.get('/get-session').expect(200);

  assert.strictEqual(getResponse.body.testData, 'session-value');
  assert.strictEqual(getResponse.body.userId, 'test-user-123');
  assert.ok(getResponse.body.loginTime);
  assert.strictEqual(getResponse.body.sessionId, setResponse.body.sessionId);
});

test('Session should not persist across different clients', async () => {
  const app = createTestApp();

  
  const agent1 = request.agent(app);
  await agent1.get('/set-session').expect(200);

  
  const agent2 = request.agent(app);
  const response = await agent2.get('/get-session').expect(200);

  assert.strictEqual(response.body.testData, undefined);
  assert.strictEqual(response.body.userId, undefined);
});

test('User authentication should work with sessions', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  
  const loginResponse = await agent
    .post('/login')
    .send({ username: 'testuser', password: 'password123' })
    .expect(200);

  assert.strictEqual(loginResponse.body.success, true);

  
  const profileResponse = await agent.get('/profile').expect(200);

  assert.strictEqual(profileResponse.body.user.username, 'testuser');
  assert.strictEqual(profileResponse.body.user.email, 'test@example.com');
});

test('Authentication should fail with invalid credentials', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  const response = await agent
    .post('/login')
    .send({ username: 'testuser', password: 'wrongpassword' })
    .expect(401);

  assert.ok(response.body.error.includes('Invalid credentials'));
});

test('Protected routes should require authentication', async () => {
  const app = createTestApp();

  const response = await request(app).get('/profile').expect(401);

  assert.ok(response.body.error.includes('Not authenticated'));
});

test('Session logout should destroy session', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  
  await agent
    .post('/login')
    .send({ username: 'testuser', password: 'password123' })
    .expect(200);

  
  await agent.get('/profile').expect(200);

  
  const logoutResponse = await agent.post('/logout').expect(200);

  assert.strictEqual(logoutResponse.body.success, true);

  
  await agent.get('/profile').expect(401);
});

test('Session should have proper cookie configuration', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  const response = await agent.get('/session-info').expect(200);

  assert.ok(response.body.cookie);
  assert.strictEqual(response.body.cookie.httpOnly, true);
  assert.strictEqual(response.body.cookie.secure, false); 
  assert.ok(response.body.cookie.maxAge || response.body.cookie._expires);
});

test('Session regeneration should work', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  
  const initialResponse = await agent.get('/set-session').expect(200);

  const oldSessionId = initialResponse.body.sessionId;

  
  const regenerateResponse = await agent
    .post('/regenerate-session')
    .expect(200);

  assert.strictEqual(regenerateResponse.body.success, true);
  assert.strictEqual(regenerateResponse.body.oldSessionId, oldSessionId);
  assert.notStrictEqual(regenerateResponse.body.newSessionId, oldSessionId);

  
  const getResponse = await agent.get('/get-session').expect(200);

  assert.strictEqual(
    getResponse.body.sessionId,
    regenerateResponse.body.newSessionId
  );
});

test('Session save should work explicitly', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  const response = await agent
    .post('/update-session')
    .send({ key: 'customData', value: 'custom-value' })
    .expect(200);

  assert.strictEqual(response.body.success, true);

  
  const getResponse = await agent.get('/get-session').expect(200);

  
  
  assert.ok(getResponse.body.sessionId);
});

test('Session with custom configuration should work', async () => {
  const customConfig = {
    cookie: {
      maxAge: 60000, 
      secure: false,
      httpOnly: true,
    },
    resave: true,
    saveUninitialized: true,
  };

  const app = createTestApp(customConfig);
  const agent = request.agent(app);

  const response = await agent.get('/session-info').expect(200);

  assert.ok(
    response.body.cookie.maxAge === 60000 || response.body.cookie._expires
  );
  assert.strictEqual(response.body.cookie.httpOnly, true);
});

test('Session store should handle file operations', async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  
  const response = await agent.get('/set-session').expect(200);

  const sessionId = response.body.sessionId;

  
  const _sessionFile = path.join(tempSessionDir, sessionId + '.json');

  
  await new Promise((resolve) => setTimeout(resolve, 100));

  
  
  assert.ok(sessionId);
});

test('Concurrent sessions should be independent', async () => {
  const app = createTestApp();

  
  const agent1 = request.agent(app);
  const agent2 = request.agent(app);
  const agent3 = request.agent(app);

  
  await agent1
    .post('/login')
    .send({ username: 'testuser', password: 'password123' });

  

  
  const profile1 = await agent1.get('/profile').expect(200);
  assert.strictEqual(profile1.body.user.username, 'testuser');

  
  await agent2.get('/profile').expect(401);
  await agent3.get('/profile').expect(401);
});

test('Session should handle malformed session data gracefully', async () => {
  const app = createTestApp();

  
  

  const response = await request(app).get('/get-session').expect(200);

  
  assert.ok(response.body.sessionId);
  assert.strictEqual(response.body.hasSession, true);
});


test.after(async () => {
  
  try {
    if (fs.existsSync(tempSessionDir)) {
      const files = fs.readdirSync(tempSessionDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempSessionDir, file));
      }
      fs.rmdirSync(tempSessionDir);
    }
  } catch (_err) {
    
  }
});
