const { withRealtimeOrigin } = require('../utils/realtime-origin');

module.exports = function realtimeOrigin(req, res, next) {
  const header = req.get('X-Socket-ID');
  const socketId =
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    typeof header === 'string' &&
    /^[\w-]{1,128}$/.test(header)
      ? header
      : undefined;
  return withRealtimeOrigin(socketId, (release) => {
    // Async work outliving the request must not inherit a stale browser origin.
    res.once('finish', release);
    res.once('close', release);
    return next();
  });
};
