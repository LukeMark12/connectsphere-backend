const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User receiving the notification
  type: { type: String, required: true, enum: ['like', 'comment', 'follow'] }, // Type of notification
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User who triggered the notification
  fromUsername: { type: String, required: true }, // Username of the user who triggered the notification
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // Post involved (if applicable)
  content: { type: String }, // Optional content (e.g., comment text)
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }, // Whether the notification has been read
});

module.exports = mongoose.model('Notification', notificationSchema);