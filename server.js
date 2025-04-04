const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://connectsp.netlify.app/',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Middleware
app.use(cors({ origin: 'https://connectsp.netlify.app/', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

// File upload setup with multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// MongoDB connection
console.log('Environment variables:', process.env);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/connectsphere';
console.log('Attempting to connect to MongoDB with URI:', MONGO_URI);
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

// Models
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  name: { type: String },
  password: { type: String, required: true },
  profilePic: { type: String },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
});
const User = mongoose.model('User', UserSchema);

const PostSchema = new mongoose.Schema({
  content: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  photos: [{ type: String }],
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

// Ensure likes is always an array and clean up null values
PostSchema.pre('save', function (next) {
  if (!Array.isArray(this.likes)) {
    this.likes = [];
  }
  this.likes = this.likes.filter((id) => id != null);
  next();
});

const Post = mongoose.model('Post', PostSchema);

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['like', 'comment', 'follow'], required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  createdAt: { type: Date, default: Date.now },
});
const Notification = mongoose.model('Notification', NotificationSchema);

// JWT Secret
const SECRET = 'your_jwt_secret';

// Middleware to verify JWT
function authenticateToken(req, res, next) {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ message: 'Access Denied' });

  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid Token' });
    req.user = user;
    next();
  });
}

// Routes

// Health check route
app.get('/api/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ message: 'Server is running', mongodbConnected: mongoose.connection.readyState === 1 });
});

// User Registration
app.post('/api/register', async (req, res) => {
  console.log('Register endpoint hit:', req.body);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { username, name, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, name, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ id: user._id }, SECRET, { expiresIn: '1h' });
    res.json({ token, userId: user._id, username: user.username });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Error registering user', error });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  console.log('Login endpoint hit:', req.body);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, SECRET, { expiresIn: '1h' });
    res.json({ token, userId: user._id, username: user.username });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Error logging in', error });
  }
});

// Get Current User Info
app.get('/api/main', authenticateToken, async (req, res) => {
  console.log('Main endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      userId: user._id,
      username: user.username,
      name: user.name,
      profilePic: user.profilePic,
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ message: 'Error fetching user info', error });
  }
});

// Get User Profile by Username
app.get('/api/users/:username', authenticateToken, async (req, res) => {
  console.log('User profile endpoint hit for username:', req.params.username);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const posts = await Post.find({ userId: user._id })
      .populate('userId', 'username profilePic')
      .sort({ createdAt: -1 });

    const currentUser = await User.findById(req.user.id);
    const isFollowing = currentUser.following.includes(user._id);

    res.json({
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        profilePic: user.profilePic,
        followers: user.followers,
        following: user.following,
        isFollowing,
      },
      posts,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Error fetching user profile', error });
  }
});

// Update User Profile
app.put('/api/profile', authenticateToken, upload.single('profilePic'), async (req, res) => {
  console.log('Profile update endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.name = req.body.name || user.name;
    if (req.file) {
      user.profilePic = `/uploads/${req.file.filename}`;
    }

    await user.save();
    res.json({
      name: user.name,
      profilePic: user.profilePic,
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get All Users (for Follow Suggestions)
app.get('/api/users', authenticateToken, async (req, res) => {
  console.log('Users endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    const users = await User.find({}, 'username name profilePic followers following');
    const usersWithFollowingStatus = users.map((user) => {
      const userObj = user.toObject();
      userObj.following = currentUser.following.includes(user._id);
      return userObj;
    });

    res.json(usersWithFollowingStatus);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users', error });
  }
});

// Follow a User
app.post('/api/follow/:userId', authenticateToken, async (req, res) => {
  console.log('Follow endpoint hit for user:', req.user.id, 'to follow:', req.params.userId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findById(req.user.id);
    const userToFollow = await User.findById(req.params.userId);

    if (!user || !userToFollow) return res.status(404).json({ message: 'User not found' });
    if (user._id.toString() === req.params.userId) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }

    if (!user.following.includes(req.params.userId)) {
      user.following.push(req.params.userId);
      userToFollow.followers.push(user._id);
      await user.save();
      await userToFollow.save();

      // Create a notification
      const notification = new Notification({
        userId: userToFollow._id,
        fromUserId: user._id,
        type: 'follow',
      });
      await notification.save();
      io.to(userToFollow._id.toString()).emit('notification', {
        message: `${user.username} followed you`,
      });
    }

    res.json({ message: 'Followed user' });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ message: 'Error following user', error });
  }
});

// Unfollow a User
app.post('/api/unfollow/:userId', authenticateToken, async (req, res) => {
  console.log('Unfollow endpoint hit for user:', req.user.id, 'to unfollow:', req.params.userId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findById(req.user.id);
    const userToUnfollow = await User.findById(req.params.userId);

    if (!user || !userToUnfollow) return res.status(404).json({ message: 'User not found' });

    user.following = user.following.filter((id) => id.toString() !== req.params.userId);
    userToUnfollow.followers = userToUnfollow.followers.filter(
      (id) => id.toString() !== user._id.toString()
    );
    await user.save();
    await userToUnfollow.save();

    res.json({ message: 'Unfollowed user' });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ message: 'Error unfollowing user', error });
  }
});

// Get Feed (Posts from Followed Users and Self)
app.get('/api/feed', authenticateToken, async (req, res) => {
  console.log('Feed endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const followingIds = user.following;
    followingIds.push(user._id);

    const posts = await Post.find({
      $or: [
        { userId: { $in: followingIds }, visibility: 'public' },
        { userId: user._id },
      ],
    })
      .populate('userId', 'username profilePic')
      .sort({ createdAt: -1 })
      .limit(20);

    // Convert likes to an array of strings
    const cleanedPosts = posts.map((post) => {
      post.likes = post.likes
        .filter((like) => like != null)
        .map((like) => like.toString());
      return post.toObject();
    });

    res.json(cleanedPosts);
  } catch (error) {
    console.error('Error fetching feed:', error);
    res.status(500).json({ message: 'Error fetching feed', error });
  }
});

// Create a Post (Support multiple images)
app.post('/api/posts', authenticateToken, upload.array('photos', 10), async (req, res) => {
  console.log('Create post endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { content, visibility } = req.body;

  if (!content) return res.status(400).json({ message: 'Content is required' });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const photos = req.files ? req.files.map((file) => `/uploads/${file.filename}`) : [];

    const post = new Post({
      content,
      userId: user._id,
      username: user.username,
      photos,
      visibility: visibility || 'public',
    });
    await post.save();

    const populatedPost = await Post.findById(post._id)
      .populate('userId', 'username profilePic');

    res.json({ post: populatedPost.toObject() });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ message: 'Error creating post', error });
  }
});

// Update a Post (Support multiple images)
app.put('/api/posts/:postId', authenticateToken, upload.array('photos', 10), async (req, res) => {
  console.log('Update post endpoint hit for post:', req.params.postId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { content, visibility } = req.body;
  const { postId } = req.params;

  try {
    const post = await Post.findById(postId).populate('userId', 'username profilePic');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.userId._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    post.content = content || post.content;
    post.visibility = visibility || post.visibility;
    if (req.files && req.files.length > 0) {
      post.photos = req.files.map((file) => `/uploads/${file.filename}`);
    }
    await post.save();

    res.json({ post: post.toObject() });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ message: 'Error updating post', error });
  }
});

// Delete a Post
app.delete('/api/posts/:postId', authenticateToken, async (req, res) => {
  console.log('Delete post endpoint hit for post:', req.params.postId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { postId } = req.params;

  try {
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await post.deleteOne();
    res.json({ message: 'Post deleted' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Error deleting post', error });
  }
});

// Like a Post
app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
  console.log('Like post endpoint hit for post:', req.params.postId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { postId } = req.params;

  try {
    const user = await User.findById(req.user.id);
    const post = await Post.findById(postId).populate('userId', 'username profilePic');
    if (!user || !post) return res.status(404).json({ message: 'User or post not found' });

    if (!post.likes.includes(user._id)) {
      post.likes.push(user._id);
      await post.save();

      if (post.userId._id.toString() !== user._id.toString()) {
        const notification = new Notification({
          userId: post.userId._id,
          fromUserId: user._id,
          type: 'like',
          postId: post._id,
        });
        await notification.save();
        io.to(post.userId._id.toString()).emit('notification', {
          message: `${user.username} liked your post`,
          postId: post._id,
        });
      }
    }

    post.likes = post.likes
      .filter((like) => like != null)
      .map((like) => like.toString());

    res.json({ post: post.toObject() });
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ message: 'Error liking post', error });
  }
});

// Unlike a Post
app.post('/api/posts/:postId/unlike', authenticateToken, async (req, res) => {
  console.log('Unlike post endpoint hit for post:', req.params.postId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { postId } = req.params;

  try {
    const user = await User.findById(req.user.id);
    const post = await Post.findById(postId).populate('userId', 'username profilePic');
    if (!user || !post) return res.status(404).json({ message: 'User or post not found' });

    post.likes = post.likes.filter((id) => id.toString() !== user._id.toString());
    await post.save();

    post.likes = post.likes
      .filter((like) => like != null)
      .map((like) => like.toString());

    res.json({ post: post.toObject() });
  } catch (error) {
    console.error('Error unliking post:', error);
    res.status(500).json({ message: 'Error unliking post', error });
  }
});

// Add a Comment to a Post
app.post('/api/posts/:postId/comment', authenticateToken, async (req, res) => {
  console.log('Comment endpoint hit for post:', req.params.postId);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  const { content } = req.body;
  const { postId } = req.params;

  if (!content || content.length > 100) {
    return res.status(400).json({ message: 'Invalid comment' });
  }

  try {
    const user = await User.findById(req.user.id);
    const post = await Post.findById(postId).populate('userId', 'username profilePic');
    if (!user || !post) return res.status(404).json({ message: 'User or post not found' });

    post.comments.push({
      userId: user._id,
      username: user.username,
      content,
      createdAt: new Date(),
    });
    await post.save();

    if (post.userId._id.toString() !== user._id.toString()) {
      const notification = new Notification({
        userId: post.userId._id,
        fromUserId: user._id,
        type: 'comment',
        postId: post._id,
      });
      await notification.save();
      io.to(post.userId._id.toString()).emit('notification', {
        message: `${user.username} commented on your post`,
        postId: post._id,
      });
    }

    post.likes = post.likes
      .filter((like) => like != null)
      .map((like) => like.toString());

    res.json({ post: post.toObject() });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ message: 'Error adding comment', error });
  }
});

// Get Notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  console.log('Notifications endpoint hit for user:', req.user.id);
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Service unavailable: MongoDB not connected' });
  }

  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .populate('fromUserId', 'username')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications', error });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error in route:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

// Socket.IO Connection
const MAX_CONNECTIONS = 100; // Adjust based on your needs
let currentConnections = 0;

io.on('connection', (socket) => {
  if (currentConnections >= MAX_CONNECTIONS) {
    console.log('Max connections reached, rejecting new connection:', socket.id);
    socket.disconnect(true);
    return;
  }

  currentConnections++;
  console.log('A user connected:', socket.id, 'Total connections:', currentConnections);

  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their notification room`);
  });

  socket.on('disconnect', () => {
    currentConnections--;
    console.log('A user disconnected:', socket.id, 'Total connections:', currentConnections);
  });
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Log memory usage every 30 seconds
setInterval(() => {
  const used = process.memoryUsage();
  console.log('Memory Usage:', {
    heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(used.external / 1024 / 1024)} MB`,
  });
}, 30000);

// Start the Server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
