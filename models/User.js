const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, default: '' }, // User's display name
  profilePic: { type: String }, // URL or path to profile picture
  bio: { type: String, default: '', maxlength: 160 }, // Bio with a 160-char limit (common for social media)
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

module.exports = mongoose.model('User', userSchema);