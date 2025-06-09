const { createClient } = require('redis');
const crypto = require('crypto');

async function initRedis() {
  const redisUrl = process.env.REDIS_URL;
  const client = redisUrl ? createClient({ url: redisUrl }) : createClient();
  await client.connect();
  return client;
}

function createStores(client) {
  const usersKey = 'users';
  const listsKey = 'lists';

  const users = {
    async findOne(query, cb) {
      try {
        let result = null;
        if (query._id) {
          const data = await client.hGet(usersKey, query._id);
          result = data ? JSON.parse(data) : null;
        } else if (query.email) {
          const id = await client.get(`email:${query.email}`);
          if (id) {
            const data = await client.hGet(usersKey, id);
            result = data ? JSON.parse(data) : null;
          }
        } else if (query.username) {
          const id = await client.get(`username:${query.username}`);
          if (id) {
            const data = await client.hGet(usersKey, id);
            result = data ? JSON.parse(data) : null;
          }
        }
        if (cb) cb(null, result); else return result;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async find(query, cb) {
      try {
        let result = [];
        if (Object.keys(query).length === 0) {
          const all = await client.hVals(usersKey);
          result = all.map(JSON.parse);
        }
        if (cb) cb(null, result); else return result;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async count(query, cb) {
      try {
        const docs = await this.find(query);
        if (cb) cb(null, docs.length); else return docs.length;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async insert(doc, cb) {
      try {
        if (!doc._id) doc._id = crypto.randomBytes(12).toString('hex');
        await client.hSet(usersKey, doc._id, JSON.stringify(doc));
        if (doc.email) await client.set(`email:${doc.email}`, doc._id);
        if (doc.username) await client.set(`username:${doc.username}`, doc._id);
        if (cb) cb(null, doc); else return doc;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async update(query, update, cb) {
      try {
        const doc = await this.findOne(query);
        if (!doc) { if (cb) cb(null, 0); else return 0; return; }
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$unset) {
          for (const k of Object.keys(update.$unset)) delete doc[k];
        }
        await client.hSet(usersKey, doc._id, JSON.stringify(doc));
        if (update.$set && update.$set.email) await client.set(`email:${doc.email}`, doc._id);
        if (update.$set && update.$set.username) await client.set(`username:${doc.username}`, doc._id);
        if (cb) cb(null, 1); else return 1;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async remove(query, cb) {
      try {
        if (query._id) {
          const doc = await this.findOne({_id: query._id});
          if (!doc) { if (cb) cb(null, 0); else return 0; return; }
          await client.hDel(usersKey, query._id);
          if (doc.email) await client.del(`email:${doc.email}`);
          if (doc.username) await client.del(`username:${doc.username}`);
          if (cb) cb(null, 1); else return 1;
          return;
        }
        if (Object.keys(query).length === 0) {
          await client.del(usersKey);
          if (cb) cb(null, 1); else return 1;
          return;
        }
        if (cb) cb(null, 0); else return 0;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    }
  };

  const lists = {
    async findOne(query, cb) {
      try {
        let result = null;
        if (query._id) {
          const data = await client.hGet(listsKey, query._id);
          result = data ? JSON.parse(data) : null;
        } else if (query.userId && query.name) {
          const ids = await client.sMembers(`user_lists:${query.userId}`);
          for (const id of ids) {
            const data = await client.hGet(listsKey, id);
            const l = JSON.parse(data);
            if (l.name === query.name) { result = l; break; }
          }
        }
        if (cb) cb(null, result); else return result;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async find(query, cb) {
      try {
        let result = [];
        if (Object.keys(query).length === 0) {
          const all = await client.hVals(listsKey);
          result = all.map(JSON.parse);
        } else if (query.userId) {
          const ids = await client.sMembers(`user_lists:${query.userId}`);
          for (const id of ids) {
            const data = await client.hGet(listsKey, id);
            if (data) result.push(JSON.parse(data));
          }
        }
        if (cb) cb(null, result); else return result;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async count(query, cb) {
      try {
        const docs = await this.find(query);
        if (cb) cb(null, docs.length); else return docs.length;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async insert(doc, cb) {
      try {
        if (!doc._id) doc._id = crypto.randomBytes(12).toString('hex');
        await client.hSet(listsKey, doc._id, JSON.stringify(doc));
        if (doc.userId) await client.sAdd(`user_lists:${doc.userId}`, doc._id);
        if (cb) cb(null, doc); else return doc;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async update(query, update, cb) {
      try {
        const doc = await this.findOne(query);
        if (!doc) { if (cb) cb(null, 0); else return 0; return; }
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$unset) {
          for (const k of Object.keys(update.$unset)) delete doc[k];
        }
        await client.hSet(listsKey, doc._id, JSON.stringify(doc));
        if (cb) cb(null, 1); else return 1;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    },
    async remove(query, cb) {
      try {
        if (query._id) {
          const doc = await this.findOne({_id: query._id});
          if (!doc) { if (cb) cb(null, 0); else return 0; return; }
          await client.hDel(listsKey, doc._id);
          await client.sRem(`user_lists:${doc.userId}`, doc._id);
          if (cb) cb(null, 1); else return 1;
          return;
        }
        if (query.userId && !query.name) {
          const ids = await client.sMembers(`user_lists:${query.userId}`);
          for (const id of ids) {
            await client.hDel(listsKey, id);
          }
          await client.del(`user_lists:${query.userId}`);
          if (cb) cb(null, ids.length); else return ids.length;
          return;
        }
        if (Object.keys(query).length === 0) {
          await client.del(listsKey);
          if (cb) cb(null, 1); else return 1;
          return;
        }
        if (cb) cb(null, 0); else return 0;
      } catch (err) {
        if (cb) cb(err); else throw err;
      }
    }
  };

  return { users, lists };
}

module.exports = { initRedis, createStores };
