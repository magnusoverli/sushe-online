const mongoose = require('mongoose');
const PLM = require('passport-local-mongoose');
const userSchema = new mongoose.Schema({
  resetToken: String,
  resetExpires: Date
});
userSchema.plugin(PLM); // adds username, hash/salt, register(), setPassword(), authenticate(), etc.
module.exports = mongoose.model('User', userSchema);
