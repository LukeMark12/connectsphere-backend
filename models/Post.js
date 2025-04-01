const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  content: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  photo: { type: String },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
  comments: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      username: { type: String },
      content: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  createdAt: { type: Date, default: Date.now },
});

// Ensure likes is always an array
postSchema.pre('save', function (next) {
  if (!Array.isArray(this.likes)) {
    this.likes = [];
  }
  this.likes = this.likes.filter((id) => id != null); // Remove null/undefined values
  next();
});

module.exports = mongoose.model('Post', postSchema);