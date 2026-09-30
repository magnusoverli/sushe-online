const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function createCallback() {
  return {
    id: 'callback-1',
    data: `event:${EVENT_ID}:approve`,
    from: { id: 123, is_bot: false },
    message: { message_id: 456, chat: { id: -789 }, date: 1000 },
  };
}

module.exports = { EVENT_ID, createCallback };
