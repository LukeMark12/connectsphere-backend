const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs'); // Add this for creating the uploads directory
const User = require('./models/User');
const Post = require('./models/Post');
const Comment = require('./models/Comment');
const Notification = require('./models/Notification');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://connectsp.netlify.app',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: 'https://connectsp.netlify.app',
  credentials: true,
}));
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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/connectsphere';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied' });

  jwt.verify(token, 'your_jwt_secret', (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Socket.IO for real-time notifications
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, name });
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1h' });
    res.json({ token, userId: user._id, username: user.username });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create Post
app.post('/api/posts', authenticateToken, upload.array('photos', 10), async (req, res) => {
  try {
    const { content, visibility } = req.body;
    const photos = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    const post = new Post({
      userId: req.user.userId,
      content,
      photos,
      visibility: visibility || 'public',
    });
    await post.save();

    const populatedPost = await Post.findById(post._id).populate('userId', 'username name profilePic');
    res.status(201).json(populatedPost);
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Posts (Feed)
app.get('/api/posts', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const following = user.following || [];
    following.push(req.user.userId);

    const posts = await Post.find({
      $or: [
        { userId: { $in: following }, visibility: 'public' },
        { userId: req.user.userId },
      ],
    })
      .populate('userId', 'username name profilePic')
      .populate('comments.userId', 'username')
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Like Post
app.post('/api/posts/:id/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (!post.likes.includes(req.user.userId)) {
      post.likes.push(req.user.userId);
      await post.save();

      if (post.userId.toString() !== req.user.userId) {
        const notification = new Notification({
          userId: post.userId,
          fromUserId: req.user.userId,
          type: 'like',
          postId: post._id,
        });
        await notification.save();
        io.to(post.userId.toString()).emit('notification', notification);
      }
    }

    res.json(post);
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Comment on Post
app.post('/api/posts/:id/comment', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const user = await User.findById(req.user.userId);
    const comment = { userId: req.user.userId, username: user.username, content };
    post.comments.push(comment);
    await post.save();

    if (post.userId.toString() !== req.user.userId) {
      const notification = new Notification({
        userId: post.userId,
        fromUserId: req.user.userId,
        type: 'comment',
        postId: post._id,
      });
      await notification.save();
      io.to(post.userId.toString()).emit('notification', notification);
    }

    res.json(post);
  } catch (error) {
    console.error('Error commenting on post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Follow User
app.post('/api/follow/:id', authenticateToken, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.userId);

    if (!userToFollow || !currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!currentUser.following.includes(req.params.id)) {
      currentUser.following.push(req.params.id);
      userToFollow.followers.push(req.user.userId);
      await currentUser.save();
      await userToFollow.save();

      const notification = new Notification({
        userId: req.params.id,
        fromUserId: req.user.userId,
        type: 'follow',
      });
      await notification.save();
      io.to(req.params.id).emit('notification', notification);
    }

    res.json({ message: 'Followed successfully' });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unfollow User
app.post('/api/unfollow/:id', authenticateToken, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.userId);

    if (!userToUnfollow || !currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
    userToUnfollow.followers = userToUnfollow.followers.filter(id => id.toString() !== req.user.userId);
    await currentUser.save();
    await userToUnfollow.save();

    res.json({ message: 'Unfollowed successfully' });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get User Profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update Profile
app.put('/api/profile', authenticateToken, upload.single('profilePic'), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
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

// Get Other User's Profile
app.get('/api/users/:username', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const posts = await Post.find({ userId: user._id })
      .populate('userId', 'username name profilePic')
      .populate('comments.userId', 'username')
      .sort({ createdAt: -1 });

    const currentUser = await User.findById(req.user.userId);
    const isFollowing = currentUser.following.includes(user._id);

    res.json({ user: { ...user.toObject(), isFollowing }, posts });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.userId })
      .populate('fromUserId', 'username name profilePic')
      .sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
