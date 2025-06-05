const util = require('util');

function promisifyDatastore(db) {
  return {
    findOne: util.promisify(db.findOne.bind(db)),
    find: util.promisify(db.find.bind(db)),
    count: util.promisify(db.count.bind(db)),
    insert: util.promisify(db.insert.bind(db)),
    update: util.promisify(db.update.bind(db)),
    remove: util.promisify(db.remove.bind(db)),
  };
}

module.exports = promisifyDatastore;
